import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { database } from '../database.js';
import { authorizeVehicle, FleetError, type FleetActor } from './service.js';

const fileSchema=z.object({kind:z.enum(['PHOTO','REGISTRATION','OPERATING_PERMIT','OWNERSHIP_EVIDENCE']),
  mimeType:z.enum(['image/jpeg','image/png','application/pdf']),data:z.string().max(7_000_000)});
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
    try {display=await sharp(bytes,{limitInputPixels:20_000_000}).rotate().resize(800,600,{fit:'contain',background:'#eef2f5'}).jpeg({quality:88}).toBuffer();}
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
  return {bytes:!original&&f.display_bytes?f.display_bytes:f.original_bytes,
    mimeType:!original&&f.display_bytes?'image/jpeg':String(f.mime_type)};
}
