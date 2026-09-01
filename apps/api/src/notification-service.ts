import {database} from './database.js';
import {sendPush,type PushResult} from './push.js';
import {notificationClassification,type NotificationCategory,type NotificationPriority} from './user-notifications.js';

export type NotificationStatus='CREATED'|'QUEUED'|'SENT'|'FAILED'|'SKIPPED';
export interface NotificationCommand {
  userId:string;
  type:string;
  category:NotificationCategory;
  priority:NotificationPriority;
  title:string;
  body:string;
  referenceId?:string;
  deepLink?:string;
  action?:string;
  metadata?:Record<string,unknown>;
  persistInCenter:boolean;
  sendPush:boolean;
  idempotencyKey?:string;
  scheduledAt?:Date;
}
export interface NotificationResult {
  notificationId:string;
  accepted:boolean;
  pushSent:boolean;
  persisted:boolean;
  providerMessageId?:string;
  status:NotificationStatus;
  errorCode?:string;
  errorMessage?:string;
}

function stringData(command:NotificationCommand):Record<string,string>{
  const data:Record<string,string>={
    type:command.type,notificationCategory:command.category,notificationPriority:command.priority,
    notificationRoute:command.deepLink?.startsWith('costa-go://trip/prepare')?'SMART_TRIP':'NOTIFICATIONS'
  };
  if(command.referenceId)data.referenceId=command.referenceId;
  if(command.deepLink)data.deepLink=command.deepLink;
  if(command.action)data.action=command.action;
  if(command.idempotencyKey)data.idempotencyKey=command.idempotencyKey;
  for(const [key,value] of Object.entries(command.metadata??{}))if(value!==undefined&&value!==null)data[key]=typeof value==='string'?value:JSON.stringify(value);
  return data;
}

export class NotificationService {
  async send(command:NotificationCommand):Promise<NotificationResult>{
    const classification=notificationClassification(command.type);
    const normalized={...command,category:command.category??classification.category,priority:command.priority??classification.priority};
    if(!process.env.DATABASE_URL){
      if(!normalized.sendPush)return {notificationId:'',accepted:true,pushSent:false,persisted:false,status:'CREATED'};
      const result=await sendPush(normalized.userId,normalized.title,normalized.body,stringData(normalized));
      return this.result('',false,result);
    }
    const [claimed]=await database()`insert into user_notifications
      (user_id,title,message,notification_type,category,priority,reference_id,deep_link,action,data,status,
       persist_in_center,send_push,idempotency_key,event_key,scheduled_at)
      values (${normalized.userId},${normalized.title},${normalized.body},${normalized.type},${normalized.category},${normalized.priority},
        ${normalized.referenceId??null},${normalized.deepLink??null},${normalized.action??null},${JSON.stringify(normalized.metadata??{})}::jsonb,
        ${normalized.scheduledAt?'QUEUED':'CREATED'},${normalized.persistInCenter},${normalized.sendPush},${normalized.idempotencyKey??null},
        ${normalized.idempotencyKey??null},${normalized.scheduledAt??null})
      on conflict (idempotency_key) where idempotency_key is not null do nothing returning id::text`;
    if(!claimed&&normalized.idempotencyKey){
      const [existing]=await database()`select id::text,status from user_notifications where idempotency_key=${normalized.idempotencyKey}`;
      return {notificationId:String(existing?.id??''),accepted:false,pushSent:existing?.status==='SENT',persisted:true,status:'SKIPPED',errorCode:'notification/duplicate'};
    }
    const notificationId=String(claimed?.id??'');
    await database()`insert into notification_analytics_events(notification_id,user_id,event) values (${notificationId},${normalized.userId},'CREATED')`;
    if(normalized.scheduledAt&&normalized.scheduledAt.getTime()>Date.now())return {notificationId,accepted:true,pushSent:false,persisted:true,status:'QUEUED'};
    if(!normalized.sendPush)return {notificationId,accepted:true,pushSent:false,persisted:true,status:'CREATED'};
    const push=await sendPush(normalized.userId,normalized.title,normalized.body,stringData(normalized));
    const status:NotificationStatus=push.sent>0?'SENT':push.skipped?'SKIPPED':'FAILED';
    await database()`update user_notifications set status=${status},push_sent_at=case when ${push.sent}>0 then now() else push_sent_at end,
      error_code=${push.errorCode??push.errors?.[0]?.code??null},error_message=${push.errors?.[0]?.message??null} where id=${notificationId}`;
    await database()`insert into notification_analytics_events(notification_id,user_id,event,metadata)
      values (${notificationId},${normalized.userId},${push.sent>0?'SENT':push.skipped?'FAILED':'FAILED'},${JSON.stringify({attempted:push.attempted??0,sent:push.sent,failed:push.failed??0})}::jsonb)`;
    return this.result(notificationId,true,push);
  }
  async sendBulk(commands:NotificationCommand[]):Promise<NotificationResult[]>{
    const results:NotificationResult[]=[];
    for(const command of commands)results.push(await this.send(command));
    return results;
  }
  private result(notificationId:string,persisted:boolean,push:PushResult):NotificationResult{
    const status:NotificationStatus=push.sent>0?'SENT':push.skipped?'SKIPPED':'FAILED';
    return {notificationId,accepted:!push.skipped,pushSent:push.sent>0,persisted,status,errorCode:push.errorCode??push.errors?.[0]?.code,errorMessage:push.errors?.[0]?.message};
  }
}

export const notificationService=new NotificationService();
