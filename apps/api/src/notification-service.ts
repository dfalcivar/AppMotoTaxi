import {database} from './database.js';
import {normalizePushData,sendPush,type PushResult} from './push.js';
import {notificationClassification,type NotificationCategory,type NotificationPriority} from './user-notifications.js';
import {enqueueNotification,immediatePriorities,isRetriablePushError,notificationTtlMs} from './notification-reliability.js';

export type NotificationStatus='CREATED'|'QUEUED'|'PROCESSING'|'RETRY'|'SENT'|'FAILED'|'SKIPPED'|'DEAD_LETTER'|'EXPIRED';
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

export function notificationRouteForCommand(type:string,deepLink?:string):string{
  const normalized=type.trim().toUpperCase();
  if(normalized==='APP_UPDATE')return 'APP_STORE';
  if(normalized.startsWith('MEMBERSHIP_'))return 'MEMBERSHIP';
  if(deepLink?.startsWith('costa-go://trip/prepare'))return 'SMART_TRIP';
  return 'NOTIFICATIONS';
}

function stringData(command:NotificationCommand):Record<string,string>{
  return normalizePushData({
    type:command.type,notificationCategory:command.category,notificationPriority:command.priority,
    notificationRoute:notificationRouteForCommand(command.type,command.deepLink),
    referenceId:command.referenceId,deepLink:command.deepLink,action:command.action,idempotencyKey:command.idempotencyKey,
    ...(command.metadata??{})
  });
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
    if(!normalized.sendPush)return {notificationId,accepted:true,pushSent:false,persisted:true,status:'CREATED'};
    const expiresAt=new Date((normalized.scheduledAt?.getTime()??Date.now())+notificationTtlMs(normalized.priority,normalized.type));
    const collapseKey=normalized.referenceId?`${normalized.type}:${normalized.referenceId}`:`${normalized.type}:${normalized.userId}`;
    const future=Boolean(normalized.scheduledAt&&normalized.scheduledAt.getTime()>Date.now());
    if(future||!immediatePriorities.has(normalized.priority)){
      await enqueueNotification({notificationId,userId:normalized.userId,priority:normalized.priority,expiresAt,collapseKey});
      if(normalized.scheduledAt)await database()`update notification_delivery_jobs set next_attempt_at=${normalized.scheduledAt} where notification_id=${notificationId}`;
      await database()`insert into notification_analytics_events(notification_id,user_id,event) values (${notificationId},${normalized.userId},'QUEUED')`;
      return {notificationId,accepted:true,pushSent:false,persisted:true,status:'QUEUED'};
    }
    const push=await sendPush(normalized.userId,normalized.title,normalized.body,{...stringData(normalized),internalNotificationId:notificationId},{expiresAt,collapseKey,priority:normalized.priority});
    const immediateError=push.errorCode??push.errors?.[0]?.code;
    if(push.sent===0&&!push.skipped&&isRetriablePushError(immediateError)){
      await enqueueNotification({notificationId,userId:normalized.userId,priority:normalized.priority,expiresAt,collapseKey});
      await database()`update user_notifications set error_code=${immediateError??null},error_message=${push.errors?.[0]?.message??null} where id=${notificationId}`;
      await database()`insert into notification_analytics_events(notification_id,user_id,event,metadata) values(${notificationId},${normalized.userId},'RETRY',${JSON.stringify({immediate:true,errorCode:immediateError})}::jsonb)`;
      return {notificationId,accepted:true,pushSent:false,persisted:true,status:'RETRY',errorCode:immediateError,errorMessage:push.errors?.[0]?.message};
    }
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
