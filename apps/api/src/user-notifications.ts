import { database } from "./database.js";

const persistentTypes = new Set([
  "FLEET_SESSION",
  "TRIP_OFFER",
  "TRIP_OFFER_CANCELLED",
  "SCHEDULED_TRIP_AVAILABLE",
  "CHAT_MESSAGE",
  "TRIP_ASSIGNED",
  "DRIVER_EN_ROUTE",
  "DRIVER_ARRIVED",
  "IN_PROGRESS",
  "COMPLETED",
  "TRIP_CANCELLED",
  "DRIVER_CANCELLED_REASSIGNING",
  "SCHEDULED_TRIP_CREATED",
  "SCHEDULED_TRIP_ASSIGNED",
  "SCHEDULED_TRIP_REMINDER",
  "SCHEDULED_DRIVER_REMINDER",
  "SCHEDULED_TRIP_RELEASED",
  "SCHEDULED_TRIP_ACCEPTED",
  "SUPPORT_RESPONSE",
  "SUPPORT_UPDATE",
  "SUPPORT_STATUS_CHANGED",
  "SYSTEM",
  "SMART_FREQUENT_TRIP",
  "SMART_RETURN_HOME",
  "SMART_FAVORITE_DESTINATION",
  "SMART_REACTIVATION",
  "CAMPAIGN",
  "EVENT",
  "PROMOTIONAL",
  "TEST_PUSH"
]);

export type NotificationCategory = "TRANSACTIONAL" | "OPERATIONAL" | "REMINDER" | "SYSTEM" | "SMART" | "CAMPAIGN" | "PROMOTIONAL";
export type NotificationPriority = "SECURITY" | "TRIP_CRITICAL" | "OPERATIONAL" | "REMINDER" | "SMART" | "SYSTEM" | "CAMPAIGN" | "PROMOTIONAL";

export function notificationClassification(type: string): { category: NotificationCategory; priority: NotificationPriority } {
  const normalized=type.toUpperCase();
  if(normalized.startsWith("SECURITY_")||normalized.includes("PASSWORD")||normalized.includes("ACCOUNT_LOCK"))return {category:"SYSTEM",priority:"SECURITY"};
  if(normalized.startsWith("SMART_"))return {category:"SMART",priority:"SMART"};
  if(normalized==="CAMPAIGN"||normalized==="EVENT")return {category:"CAMPAIGN",priority:"CAMPAIGN"};
  if(normalized==="PROMOTIONAL")return {category:"PROMOTIONAL",priority:"PROMOTIONAL"};
  if(normalized==='APP_UPDATE'||normalized==='SYSTEM')return {category:'SYSTEM',priority:'SYSTEM'};
  if(normalized==='SCHEDULED_TRIP_REMINDER'||normalized==='SCHEDULED_DRIVER_REMINDER'||normalized==='MEMBERSHIP_EXPIRING')return {category:'REMINDER',priority:'REMINDER'};
  if(normalized.startsWith("MEMBERSHIP_")||normalized.startsWith("SUPPORT_")||normalized==="FLEET_SESSION")return {category:"OPERATIONAL",priority:"OPERATIONAL"};
  return {category:"TRANSACTIONAL",priority:["TRIP_OFFER","TRIP_OFFER_CANCELLED","TRIP_ASSIGNED","DRIVER_EN_ROUTE","DRIVER_ARRIVED","IN_PROGRESS","COMPLETED","TRIP_CANCELLED","DRIVER_CANCELLED_REASSIGNING","NO_DRIVER"].includes(normalized)?"TRIP_CRITICAL":"OPERATIONAL"};
}

function uuid(value: string | undefined): string | null {
  return value && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value) ? value : null;
}

export function shouldPersistNotification(type: string): boolean {
  return persistentTypes.has(type);
}

export async function persistUserNotification(input: {
  userId: string;
  title: string;
  message: string;
  type: string;
  data?: Record<string, string>;
}): Promise<string | undefined> {
  if (!process.env.DATABASE_URL || !shouldPersistNotification(input.type)) return undefined;
  const classification=notificationClassification(input.type);
  const entityId = uuid(input.data?.tripId ?? input.data?.incidentId ?? input.data?.vehicleId);
  const entityType = input.data?.tripId ? "TRIP" : input.data?.incidentId ? "INCIDENT" : input.data?.vehicleId ? 'VEHICLE' : null;
  const uniquePart = input.data?.messageId ?? input.data?.eventId ?? input.data?.eventAt ?? input.type;
  const idempotencyKey=input.data?.idempotencyKey;
  const eventKey = idempotencyKey ?? (entityId ? `${input.type}:${entityId}:${uniquePart}` : undefined);
  const [stored] = await database()`
    insert into user_notifications
      (user_id, title, message, notification_type, entity_type, entity_id, event_key, data,
       category,priority,reference_id,deep_link,action,idempotency_key)
    values (${input.userId}, ${input.title}, ${input.message}, ${input.type}, ${entityType},
      ${entityId}, ${eventKey ?? null}, ${JSON.stringify(input.data ?? {})}::jsonb,
      ${input.data?.notificationCategory??classification.category},${input.data?.notificationPriority??classification.priority},
      ${input.data?.referenceId??null},${input.data?.deepLink??null},${input.data?.action??null},${idempotencyKey??null})
    on conflict (user_id, event_key) where event_key is not null do update
      set title=excluded.title, message=excluded.message, data=excluded.data,
        category=excluded.category,priority=excluded.priority,reference_id=coalesce(excluded.reference_id,user_notifications.reference_id),
        deep_link=coalesce(excluded.deep_link,user_notifications.deep_link),action=coalesce(excluded.action,user_notifications.action)
    returning id::text
  `;
  return stored?.id == null ? undefined : String(stored.id);
}
