import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { database } from '../database.js';
import { authorizeVehicle, FleetError, type FleetActor } from './service.js';

const fileSchema=z.object({kind:z.enum(['PHOTO','REGISTRATION','OPERATING_PERMIT','OWNERSHIP_EVIDENCE']),
  mimeType:z.enum(['image/jpeg','image/png','application/pdf']),data:z.string().max(7_000_000)});
// No subject synthesis/removal: preserve the entire real vehicle and its markings.
export async function vehicleDisplayImage(bytes:Buffer){
  return sharp(bytes,{limitInputPixels:20_000_000,failOn:'error'}).rotate()
    .normalise({lower:1,upper:99})
    .resize(800,600,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}})
    .webp({quality:82,effort:4}).toBuffer();
}
const webp=(b:Buffer)=>b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP';
// Legacy immutable files are normalized on read, never overwritten. Bounded process-local cache.
const legacyDisplayCache=new Map<string,Buffer>();
let legacyDisplayBytes=0;
// Serialize legacy decoding so a page of old 20 MP photos cannot exhaust API memory.
let legacyDisplayQueue:Promise<unknown>=Promise.resolve();
async function legacyDisplay(id:string,original:Buffer){
  const key=`${id}:${createHash('sha256').update(original).digest('hex')}`;
  const cached=legacyDisplayCache.get(key);if(cached)return cached;
  const work=legacyDisplayQueue.then(async()=>{
    const existing=legacyDisplayCache.get(key);if(existing)return existing;
    const display=await vehicleDisplayImage(original);
    while(legacyDisplayCache.size>=16||legacyDisplayBytes+display.length>8*1024*1024){
      const oldest=legacyDisplayCache.keys().next().value;if(!oldest)break;
      legacyDisplayBytes-=legacyDisplayCache.get(oldest)!.length;legacyDisplayCache.delete(oldest);
    }
    if(display.length<=8*1024*1024){legacyDisplayCache.set(key,display);legacyDisplayBytes+=display.length;}
    return display;
  });
  legacyDisplayQueue=work.catch(()=>{});
  return work;
}
export async function prepareVehicleFile(input:unknown){
  const f=fileSchema.parse(input);const bytes=Buffer.from(f.data,'base64');
  if(!bytes.length||bytes.length>5*1024*1024)throw new FleetError('FILE_TOO_LARGE',400);
  let display:Buffer|null=null;
  if(f.mimeType==='application/pdf'){
    if(f.kind==='PHOTO'||bytes.subarray(0,5).toString()!=='%PDF-')throw new FleetError('INVALID_FILE',400);
  }else{
    try{
      const image=sharp(bytes,{limitInputPixels:20_000_000,failOn:'error'});
      const meta=await image.metadata();
      if(meta.format!==(f.mimeType==='image/png'?'png':'jpeg')||!meta.width||!meta.height)throw new Error('format');
    }catch{throw new FleetError('INVALID_IMAGE',400);}
    // A valid original remains usable even if the optional display conversion fails.
    try {display=f.kind==='PHOTO'?await vehicleDisplayImage(bytes):await sharp(bytes,{limitInputPixels:20_000_000}).rotate().resize(800,600,{fit:'inside',withoutEnlargement:true}).jpeg({quality:88}).toBuffer();}
    catch {display=null;}
  }
  return {kind:f.kind,mimeType:f.mimeType,bytes,display,hash:createHash('sha256').update(bytes).digest('hex')};
}
export async function uploadVehicleFile(actor:FleetActor,vehicleId:string,input:unknown){
  const file=await prepareVehicleFile(input);
  return database().begin(async tx=>{
    await tx`select pg_advisory_xact_lock(737301)`;
    // Pending applicants can provide evidence only, not overwrite another unit's photograph.
    if(file.kind==='OWNERSHIP_EVIDENCE'){
      const [v]=await tx`select id from vehicles where id=${vehicleId} and merged_into is null`;
      if(!v)throw new FleetError('VEHICLE_FORBIDDEN',403);
    }else{
      try{await authorizeVehicle(tx,actor,vehicleId,true);}catch(error){
        const [pending]=await tx`select 1 from vehicles v join user_vehicle_relations r on r.vehicle_id=v.id
          where v.id=${vehicleId} and v.fleet_status='PENDING' and r.user_id=${actor.id} and r.status='PENDING'
          and v.created_by=${actor.id}
          and not exists(select 1 from user_vehicle_relations a where a.vehicle_id=v.id and a.status='APPROVED')`;
        if(!pending)throw error;
      }
    }
    const [saved]=await tx`insert into vehicle_files(vehicle_id,kind,mime_type,original_bytes,display_bytes,sha256,uploaded_by)
      values(${vehicleId},${file.kind},${file.mimeType},${file.bytes},${file.display},${file.hash},${actor.id}) returning id`;
    if(file.kind==='PHOTO')await tx`update vehicles set photo_id=${saved!.id},updated_at=now() where id=${vehicleId}`;
    await tx`insert into vehicle_audit(vehicle_id,actor_id,action,next_value,source_ip)
      values(${vehicleId},${actor.id},'vehicle_file_uploaded',${JSON.stringify({fileId:saved!.id,kind:file.kind,sha256:file.hash})}::jsonb,${actor.ip??null})`;
    return {id:saved!.id};
  });
}
export async function readVehicleFile(actor:FleetActor,id:string,original=false){
  const [f]=await database()`select * from vehicle_files where id=${id}`;
  if(!f)throw new FleetError('FILE_NOT_FOUND',404);
  try{await authorizeVehicle(database(),actor,String(f.vehicle_id),original||f.kind!=='PHOTO');}
  catch(error){
    // Only the actual trip parties may read that trip's immutable vehicle photo.
    const [trip]=!original&&f.kind==='PHOTO'?await database()`select 1 from trips t where
      (t.passenger_id=${actor.id} or t.driver_id=${actor.id}) and t.vehicle_snapshot->>'photoId'=${id} limit 1`:[];
    if(!trip&&f.uploaded_by!==actor.id)throw error;
  }
  if(!original&&f.kind==='PHOTO'){
    const display=f.display_bytes?Buffer.from(f.display_bytes):null;
    if(display&&webp(display)){
      try {
        const meta=await sharp(display,{limitInputPixels:20_000_000}).metadata();
        if(meta.width&&meta.height)return {bytes:display,mimeType:'image/webp'};
      }catch{/* Invalid stored preview: recover from the untouched original below. */}
    }
    try{return {bytes:await legacyDisplay(id,Buffer.from(f.original_bytes)),mimeType:'image/webp'};}
    catch{/* A failed optional conversion must not hide the real original. */}
    return {bytes:f.original_bytes,mimeType:String(f.mime_type)};
  }
  return {bytes:!original&&f.display_bytes?f.display_bytes:f.original_bytes,
    mimeType:!original&&f.display_bytes?'image/jpeg':String(f.mime_type)};
}
