import type {FastifyInstance,FastifyReply,FastifyRequest} from 'fastify';
import {z} from 'zod';
import sharp from 'sharp';
import {database} from './database.js';
import {requirePermission} from './admin.js';
import {readHelpAsset,storeHelpAsset} from './campaign-asset-storage.js';

const slug=z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100);
const id=z.string().uuid();
const article=z.object({
  slug,title:z.string().trim().min(5).max(160),summary:z.string().trim().min(10).max(400),
  body:z.string().trim().min(30).max(30000),category:z.string().trim().min(3).max(100),
  audience:z.enum(['DRIVER','PASSENGER','BOTH']),status:z.enum(['DRAFT','PUBLISHED','HIDDEN']),
  featured:z.boolean().default(false),sortOrder:z.number().int().min(0).max(10000).default(0)
});
const mediaKinds=['cover','video','pdf'] as const;
const mediaTypes:{[K in typeof mediaKinds[number]]:string[]}={cover:['image/jpeg','image/png','image/webp'],video:['video/mp4'],pdf:['application/pdf']};
function mediaUrl(row:any,kind:typeof mediaKinds[number]) {return row[`${kind}_key`]?`/v1/help/articles/${row.slug}/media/${kind}`:row[`${kind}_url`]??null;}
function present(row:any,admin=false) {return {id:row.id,slug:row.slug,title:row.title,summary:row.summary,body:row.body,category:row.category,audience:row.audience,status:admin?row.status:undefined,featured:row.featured,sortOrder:row.sort_order,coverUrl:mediaUrl(row,'cover'),videoUrl:mediaUrl(row,'video'),pdfUrl:mediaUrl(row,'pdf'),createdAt:row.created_at,publishedAt:admin?row.published_at:undefined,updatedAt:row.updated_at};}
function error(reply:FastifyReply,cause:unknown) {
  if(cause instanceof z.ZodError)return reply.code(400).send({error:'INVALID_DATA',message:cause.issues[0]?.message});
  const message=cause instanceof Error?cause.message:'';
  if(message==='FORBIDDEN'||message==='UNAUTHORIZED')return reply.code(message==='FORBIDDEN'?403:401).send({error:message});
  if(message==='HELP_STORAGE_UNAVAILABLE'||message==='CAMPAIGN_STORAGE_NOT_CONFIGURED')return reply.code(503).send({error:'HELP_STORAGE_UNAVAILABLE',message:'No se pudo acceder al almacenamiento de archivos.'});
  if(message==='HELP_MEDIA_INVALID')return reply.code(400).send({error:message,message:'Revisa el formato y tamaño del archivo.'});
  if(message==='HELP_SLUG_EXISTS')return reply.code(409).send({error:message,message:'Esa URL ya pertenece a otro tutorial.'});
  throw cause;
}
async function audit(actorId:string,action:string,articleId:string,details:unknown) {
  await database()`insert into audit_log(actor_id,action,entity_type,entity_id,next_value,reason)
    values(${actorId},${action},'HELP_ARTICLE',${articleId},${JSON.stringify(details)}::jsonb,'Centro de ayuda')`;
}
export function registerHelpCenterRoutes(app:FastifyInstance) {
  app.get('/v1/help/articles',async(request,reply)=>{try {
    const query=z.object({audience:z.enum(['DRIVER','PASSENGER']).optional(),q:z.string().trim().max(100).optional()}).parse(request.query);
    const q=query.q?`%${query.q}%`:null;
    const rows=await database()`select * from help_articles where status='PUBLISHED'
      and (${query.audience??null}::text is null or audience in ('BOTH',${query.audience??null}))
      and (${q}::text is null or title ilike ${q} or summary ilike ${q} or body ilike ${q})
      order by featured desc,sort_order,updated_at desc limit 100`;
    reply.header('Cache-Control','public, max-age=60');return rows.map(row=>present(row));
  }catch(e){return error(reply,e);}});
  app.get('/v1/help/articles/:slug',async(request,reply)=>{try {
    const key=slug.parse((request.params as any).slug);
    const [row]=await database()`select * from help_articles where slug=${key} and status='PUBLISHED'`;
    if(!row)return reply.code(404).send({error:'HELP_ARTICLE_NOT_FOUND'});
    reply.header('Cache-Control','public, max-age=60');return present(row);
  }catch(e){return error(reply,e);}});
  app.get('/v1/help/faqs',async(_request,reply)=>{
    const rows=await database()`select category,question,answer,audiences from support_faqs where active=true order by sort_order,category,question limit 100`;
    reply.header('Cache-Control','public, max-age=60');return rows;
  });
  app.get('/v1/help/articles/:slug/media/:kind',async(request,reply)=>{try {
    const params=z.object({slug,kind:z.enum(mediaKinds)}).parse(request.params);
    const [row]=await database()`select * from help_articles where slug=${params.slug} and status='PUBLISHED'`;
    if(!row||!row[`${params.kind}_key`])return reply.code(404).send({error:'HELP_MEDIA_NOT_FOUND'});
    const bytes=await readHelpAsset(String(row[`${params.kind}_key`]));
    const mime=params.kind==='video'?'video/mp4':params.kind==='pdf'?'application/pdf':String(row.cover_mime??'image/jpeg');
    reply.header('Content-Type',mime).header('Cache-Control','public, max-age=60');
    const download=(request.query as {download?:string})?.download==='1' && params.kind==='pdf';
    reply.header('Content-Disposition',`${download?'attachment':'inline'}; filename="${params.slug}.${params.kind==='cover'?'jpg':params.kind==='video'?'mp4':'pdf'}"`);
    if(params.kind==='video'){
      reply.header('Accept-Ranges','bytes');
      const range=request.headers.range;
      if(range){
        const match=/^bytes=(\d*)-(\d*)$/.exec(range);
        if(!match)return reply.code(416).header('Content-Range',`bytes */${bytes.length}`).send();
        const start=match[1]?Number(match[1]):Math.max(0,bytes.length-Number(match[2]));
        const end=match[1]?(match[2]?Number(match[2]):bytes.length-1):bytes.length-1;
        if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=bytes.length||end<start||end>=bytes.length)return reply.code(416).header('Content-Range',`bytes */${bytes.length}`).send();
        return reply.code(206).header('Content-Range',`bytes ${start}-${end}/${bytes.length}`).header('Content-Length',String(end-start+1)).send(bytes.subarray(start,end+1));
      }
    }
    reply.header('Content-Length',String(bytes.length));return reply.send(bytes);
  }catch(e){return error(reply,e);}});
  app.get('/v1/admin/help/articles',async(request,reply)=>{try {
    requirePermission(request,'help:view');
    const rows=await database()`select * from help_articles order by sort_order,updated_at desc limit 500`;
    return rows.map(row=>present(row,true));
  }catch(e){return error(reply,e);}});
  app.post('/v1/admin/help/articles',async(request,reply)=>{try {
    const actor=requirePermission(request,'help:manage'),value=article.parse(request.body);
    const [exists]=await database()`select id from help_articles where slug=${value.slug}`;if(exists)throw new Error('HELP_SLUG_EXISTS');
    const [row]=await database()`insert into help_articles(slug,title,summary,body,category,audience,status,featured,sort_order,created_by,updated_by,published_at)
      values(${value.slug},${value.title},${value.summary},${value.body},${value.category},${value.audience},${value.status},${value.featured},${value.sortOrder},${actor.id!},${actor.id!},${value.status==='PUBLISHED'?new Date():null}) returning *`;
    await audit(actor.id!,'HELP_ARTICLE_CREATED',String(row!.id),{slug:value.slug,status:value.status});return reply.code(201).send(present(row,true));
  }catch(e){return error(reply,e);}});
  app.put('/v1/admin/help/articles/:id',async(request,reply)=>{try {
    const actor=requirePermission(request,'help:manage'),key=id.parse((request.params as any).id),value=article.parse(request.body);
    const [current]=await database()`select slug from help_articles where id=${key}`;
    if(!current)return reply.code(404).send({error:'HELP_ARTICLE_NOT_FOUND'});
    if(current.slug!==value.slug)return reply.code(409).send({error:'HELP_SLUG_IMMUTABLE',message:'El enlace permanente no se puede cambiar después de crear el tutorial.'});
    const [duplicate]=await database()`select id from help_articles where slug=${value.slug} and id<>${key}`;if(duplicate)throw new Error('HELP_SLUG_EXISTS');
    const [row]=await database()`update help_articles set slug=${value.slug},title=${value.title},summary=${value.summary},body=${value.body},category=${value.category},audience=${value.audience},status=${value.status},featured=${value.featured},sort_order=${value.sortOrder},published_at=case when ${value.status}='PUBLISHED' then coalesce(published_at,now()) else published_at end,updated_by=${actor.id!},updated_at=now() where id=${key} returning *`;
    if(!row)return reply.code(404).send({error:'HELP_ARTICLE_NOT_FOUND'});
    await audit(actor.id!,'HELP_ARTICLE_UPDATED',key,{slug:value.slug,status:value.status});return present(row,true);
  }catch(e){return error(reply,e);}});
  app.delete('/v1/admin/help/articles/:id',async(request,reply)=>{try {
    const actor=requirePermission(request,'help:manage'),key=id.parse((request.params as any).id);
    const [row]=await database()`delete from help_articles where id=${key} and published_at is null returning slug`;
    if(!row)return reply.code(409).send({error:'HELP_ARTICLE_MUST_BE_HIDDEN'});
    await audit(actor.id!,'HELP_ARTICLE_DELETED',key,{slug:row.slug});return {deleted:true};
  }catch(e){return error(reply,e);}});
  app.put('/v1/admin/help/articles/:id/media/:kind',async(request,reply)=>{try {
    const actor=requirePermission(request,'help:manage'),params=z.object({id,kind:z.enum(mediaKinds)}).parse(request.params);
    const input=z.object({filename:z.string().min(3).max(180),mime:z.string(),base64:z.string().min(20).max(7_000_000)}).parse(request.body);
    if(!mediaTypes[params.kind].includes(input.mime)||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64))throw new Error('HELP_MEDIA_INVALID');
    const extension=params.kind==='video'?/\.mp4$/i:params.kind==='pdf'?/\.pdf$/i:/\.(jpe?g|png|webp)$/i;
    if(!extension.test(input.filename))throw new Error('HELP_MEDIA_INVALID');
    let bytes=Buffer.from(input.base64,'base64');
    if(bytes.length>5_000_000)throw new Error('HELP_MEDIA_INVALID');
    if(params.kind==='pdf'&&!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw new Error('HELP_MEDIA_INVALID');
    if(params.kind==='video'&&bytes.toString('ascii',4,8)!=='ftyp')throw new Error('HELP_MEDIA_INVALID');
    if(params.kind==='cover') {try {const meta=await sharp(bytes,{limitInputPixels:16_000_000}).metadata();if(!meta.width||!meta.height||meta.width>4096||meta.height>4096||'image/'+meta.format!==input.mime)throw new Error();bytes=await sharp(bytes).rotate().jpeg({quality:85}).toBuffer();}catch{throw new Error('HELP_MEDIA_INVALID');}}
    const [existing]=await database()`select id from help_articles where id=${params.id}`;if(!existing)return reply.code(404).send({error:'HELP_ARTICLE_NOT_FOUND'});
    const key=await storeHelpAsset(bytes,params.kind==='cover'?'image/jpeg':input.mime);
    const column=params.kind==='cover'?'cover_key':params.kind==='video'?'video_key':'pdf_key';
    const urlColumn=params.kind==='cover'?'cover_url':params.kind==='video'?'video_url':'pdf_url';
    const rows=await database().unsafe(`update help_articles set ${column}=$1,${urlColumn}=null,updated_by=$2,updated_at=now() where id=$3 returning *`,[key,actor.id!,params.id]);
    await audit(actor.id!,'HELP_MEDIA_UPDATED',params.id,{kind:params.kind});return present(rows[0],true);
  }catch(e){return error(reply,e);}});
}
