import {createHash} from 'node:crypto';
import {S3Client,GetObjectCommand,PutObjectCommand} from '@aws-sdk/client-s3';

export function campaignStorageConfigured() {
  return ['CAMPAIGN_S3_ENDPOINT','CAMPAIGN_S3_BUCKET','CAMPAIGN_S3_ACCESS_KEY_ID','CAMPAIGN_S3_SECRET_ACCESS_KEY']
    .every(key=>Boolean(process.env[key]?.trim()));
}
function storage() {
  if(!campaignStorageConfigured())throw new Error('CAMPAIGN_STORAGE_NOT_CONFIGURED');
  const endpoint=new URL(process.env.CAMPAIGN_S3_ENDPOINT!);
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password)throw new Error('CAMPAIGN_STORAGE_NOT_CONFIGURED');
  return {bucket:process.env.CAMPAIGN_S3_BUCKET!,client:new S3Client({
    requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED',
    endpoint:endpoint.toString(),region:process.env.CAMPAIGN_S3_REGION||'auto',forcePathStyle:true,
    credentials:{accessKeyId:process.env.CAMPAIGN_S3_ACCESS_KEY_ID!,secretAccessKey:process.env.CAMPAIGN_S3_SECRET_ACCESS_KEY!},maxAttempts:2,
  })};
}
export async function storeCampaignAsset(data:Buffer,mime:string) {
  const key='campaigns/'+createHash('sha256').update(data).digest('hex');
  const {client,bucket}=storage();
  try {
    await client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:data,ContentType:mime}),{abortSignal:AbortSignal.timeout(15000)});
    return key;
  } catch {throw new Error('CAMPAIGN_STORAGE_UNAVAILABLE');}
  finally {client.destroy();}
}
export async function readCampaignAsset(key:string) {
  if(!/^campaigns\/[a-f0-9]{64}$/.test(key))throw new Error('CAMPAIGN_NOT_FOUND');
  const {client,bucket}=storage();
  try {
    const response=await client.send(new GetObjectCommand({Bucket:bucket,Key:key}),{abortSignal:AbortSignal.timeout(15000)});
    if(!response.Body)throw new Error();
    return Buffer.from(await response.Body.transformToByteArray());
  } catch {throw new Error('CAMPAIGN_STORAGE_UNAVAILABLE');}
  finally {client.destroy();}
}
