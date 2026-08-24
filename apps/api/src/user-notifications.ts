import { database } from "./database.js";

const persistentTypes = new Set([
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
  "SYSTEM"
]);

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
  const entityId = uuid(input.data?.tripId ?? input.data?.incidentId);
  const entityType = input.data?.tripId ? "TRIP" : input.data?.incidentId ? "INCIDENT" : null;
  const uniquePart = input.data?.messageId ?? input.data?.eventId ?? input.data?.eventAt ?? input.type;
  const eventKey = entityId ? `${input.type}:${entityId}:${uniquePart}` : undefined;
  const [stored] = await database()`
    insert into user_notifications
      (user_id, title, message, notification_type, entity_type, entity_id, event_key, data)
    values (${input.userId}, ${input.title}, ${input.message}, ${input.type}, ${entityType},
      ${entityId}, ${eventKey ?? null}, ${JSON.stringify(input.data ?? {})}::jsonb)
    on conflict (user_id, event_key) where event_key is not null do update
      set title=excluded.title, message=excluded.message, data=excluded.data
    returning id::text
  `;
  return stored?.id == null ? undefined : String(stored.id);
}
