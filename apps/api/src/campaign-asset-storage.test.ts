import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({send:vi.fn(),destroy:vi.fn(),configs:[] as any[]}));
vi.mock('@aws-sdk/client-s3',()=>({
 S3Client:class {constructor(config:any){state.configs.push(config);}send=state.send;destroy=state.destroy;},
 PutObjectCommand:class {constructor(public input:any){}},GetObjectCommand:class {constructor(public input:any){}}
}));
import {campaignStorageConfigured,storeCampaignAsset,readCampaignAsset} from './campaign-asset-storage.js';
beforeEach(()=>{state.send.mockReset();state.configs=[];vi.stubEnv('CAMPAIGN_S3_ENDPOINT','https://objects.example.test');vi.stubEnv('CAMPAIGN_S3_BUCKET','private-bucket');vi.stubEnv('CAMPAIGN_S3_ACCESS_KEY_ID','fixture-key');vi.stubEnv('CAMPAIGN_S3_SECRET_ACCESS_KEY','fixture-secret');});
afterEach(()=>vi.unstubAllEnvs());
it('writes immutable object keys privately and reads only valid managed keys',async()=>{
 state.send.mockResolvedValue({});const key=await storeCampaignAsset(Buffer.from('fixture'),'image/png');
 expect(key).toMatch(/^campaigns\/[a-f0-9]{64}$/);const put=state.send.mock.calls[0]![0].input;
 expect(put).toMatchObject({Bucket:'private-bucket',Key:key,ContentType:'image/png'});expect(put.ACL).toBeUndefined();
 state.send.mockResolvedValue({Body:{transformToByteArray:async()=>Buffer.from('fixture')}});
 expect((await readCampaignAsset(key)).toString()).toBe('fixture');
 await expect(readCampaignAsset('../outside')).rejects.toThrow('CAMPAIGN_NOT_FOUND');
});
it('fails closed without configuration and masks storage errors',async()=>{
 vi.stubEnv('CAMPAIGN_S3_BUCKET','');expect(campaignStorageConfigured()).toBe(false);
 await expect(storeCampaignAsset(Buffer.from('test'),'image/png')).rejects.toThrow('CAMPAIGN_STORAGE_NOT_CONFIGURED');
 vi.stubEnv('CAMPAIGN_S3_BUCKET','bucket');state.send.mockRejectedValue(new Error('secret internal error'));
 await expect(storeCampaignAsset(Buffer.from('test'),'image/png')).rejects.toThrow('CAMPAIGN_STORAGE_UNAVAILABLE');
 vi.stubEnv('CAMPAIGN_S3_ENDPOINT','http://objects.example.test');
 await expect(storeCampaignAsset(Buffer.from('test'),'image/png')).rejects.toThrow('CAMPAIGN_STORAGE_NOT_CONFIGURED');
});
