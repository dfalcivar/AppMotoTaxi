import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { HttpsProxyAgent } from "https-proxy-agent";
import { database } from "./database.js";
import { captureOperationalError } from "./observability.js";
import { persistUserNotification } from "./user-notifications.js";

const credentialPath = fileURLToPath(new URL("../secrets/firebase-service-account.json", import.meta.url));
const firebaseProxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;

function firebaseCredential() {
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (encoded) return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  if (existsSync(credentialPath)) return JSON.parse(readFileSync(credentialPath, "utf8"));
  return undefined;
}

function messaging() {
  const serviceAccount = firebaseCredential();
  if (!serviceAccount) return undefined;
  if (!getApps().length) initializeApp({ credential: cert(serviceAccount), ...(firebaseProxy ? { httpAgent: new HttpsProxyAgent(firebaseProxy) } : {}) });
  return getMessaging();
}

function firebaseErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: unknown }).code ?? "unknown");
  }
  return "unknown";
}

export type PushDeliveryStatus = "SENT" | "PARTIAL" | "FAILED" | "SKIPPED";
export type PushResult = {
  sent: number;
  attempted?: number;
  failed?: number;
  skipped?: boolean;
  errorCode?: string;
  errors?: Array<{ code: string; message: string }>;
  durationMs?: number;
  deliveries?: Array<{ deviceTokenId: string; deviceId?: string; success: boolean; code?: string }>;
};

export type PushOptions = {
  expiresAt?: Date;
  collapseKey?: string;
  priority?: "SECURITY" | "TRIP_CRITICAL" | "OPERATIONAL" | "REMINDER" | "SMART" | "SYSTEM" | "CAMPAIGN" | "PROMOTIONAL";
  excludeDeviceIds?: string[];
};

export function pushDeliveryStatus(result: { skipped?: boolean; sent: number; failed?: number }): PushDeliveryStatus {
  if (result.skipped) return "SKIPPED";
  if (result.sent > 0 && Number(result.failed ?? 0) > 0) return "PARTIAL";
  if (result.sent > 0) return "SENT";
  return "FAILED";
}

async function recordPushDelivery(input: {
  userId: string;
  tripId?: string;
  eventType: string;
  status: PushDeliveryStatus;
  attempted?: number;
  sent?: number;
  failed?: number;
  errorCodes?: string[];
  durationMs?: number;
}): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  const tripId = input.tripId && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(input.tripId) ? input.tripId : null;
  try {
    await database()`
      insert into push_delivery_events
        (user_id, trip_id, event_type, status, attempted, sent, failed, error_codes, duration_ms)
      values (${input.userId}, ${tripId}, ${input.eventType}, ${input.status}, ${input.attempted ?? 0},
        ${input.sent ?? 0}, ${input.failed ?? 0}, ${input.errorCodes ?? []}, ${input.durationMs ?? 0})
    `;
  } catch (error) {
    console.warn("No se pudo persistir el diagnóstico de entrega push.", {
      type: input.eventType,
      code: firebaseErrorCode(error)
    });
    captureOperationalError(error, { operation: "push_delivery_audit", eventType: input.eventType });
  }
}

export type PushConfigurationStatus = {
  configured: boolean;
  projectMatches: boolean;
  serverProjectId?: string;
  errorCode?: string;
};

export function pushRouteForType(type: string | undefined): string {
  const normalized = String(type ?? "").toUpperCase();
  if (normalized === "CHAT_MESSAGE") return "CHAT";
  if (normalized.startsWith("SUPPORT_")) return "SUPPORT";
  if (["TRIP_OFFER", "TRIP_OFFER_CANCELLED", "SCHEDULED_TRIP_AVAILABLE"].includes(normalized)) return "TRIP_OFFERS";
  if (["COMPLETED", "TRIP_CANCELLED", "NO_DRIVER"].includes(normalized)) return "TRIP_DETAIL";
  if (normalized.startsWith("SCHEDULED_TRIP_") || normalized === "SCHEDULED_DRIVER_REMINDER") return "SCHEDULED_TRIPS";
  if ([
    "TRIP_ASSIGNED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "IN_PROGRESS",
    "SCHEDULED_TRIP_REMINDER", "SCHEDULED_DRIVER_REMINDER", "DRIVER_CANCELLED_REASSIGNING"
  ].includes(normalized)) return "ACTIVE_TRIP";
  if (normalized.startsWith("MEMBERSHIP_")) return "MEMBERSHIP";
  return "NOTIFICATIONS";
}

export function pushPresentationForType(
  type: string | undefined,
  fallbackTitle: string,
  fallbackBody: string
): { title: string; body: string } {
  const fixed: Record<string, { title: string; body: string }> = {
    TRIP_ASSIGNED: {
      title: "Viaje confirmado",
      body: "Un conductor aceptó tu solicitud y ya va en camino."
    },
    DRIVER_EN_ROUTE: {
      title: "Viaje confirmado",
      body: "Un conductor aceptó tu solicitud y ya va en camino."
    },
    DRIVER_ARRIVED: {
      title: "Tu conductor llegó",
      body: "Tu conductor está en el punto de recogida."
    },
    IN_PROGRESS: {
      title: "Viaje iniciado",
      body: "Tu viaje ya está en curso."
    },
    COMPLETED: {
      title: "Viaje finalizado",
      body: "El recorrido terminó correctamente. Puedes calificar tu experiencia."
    },
    NO_DRIVER: { title: "Búsqueda finalizada", body: "Ninguna mototaxi disponible en este momento." },
    DRIVER_CANCELLED_REASSIGNING: {
      title: "Buscando otro conductor",
      body: "El conductor canceló el traslado. Costa-Go ya está buscando otro conductor."
    }
  };
  const key=String(type ?? "").toUpperCase();
  return fixed[key==='ASSIGNED'?'TRIP_ASSIGNED':key] ?? {
    title: fallbackTitle,
    body: fallbackBody
  };
}

export function pushConfigurationStatus(clientProjectId?: string): PushConfigurationStatus {
  try {
    const serviceAccount = firebaseCredential() as { project_id?: string } | undefined;
    if (!serviceAccount) return { configured: false, projectMatches: false, errorCode: "firebase/not-configured" };
    const serverProjectId = String(serviceAccount.project_id ?? "");
    return {
      configured: true,
      projectMatches: !clientProjectId || serverProjectId === clientProjectId,
      serverProjectId,
      ...(clientProjectId && serverProjectId !== clientProjectId
        ? { errorCode: "firebase/project-mismatch" }
        : {})
    };
  } catch (error) {
    console.error("No se pudo leer la credencial de Firebase.", {
      error: error instanceof Error ? error.message : String(error)
    });
    return { configured: false, projectMatches: false, errorCode: "firebase/invalid-credential" };
  }
}

export async function sendPush(userId: string, title: string, body: string, data: Record<string, string> = {}, options: PushOptions = {}): Promise<PushResult> {
  const startedAt = performance.now();
  const eventType = data.type ?? "UNKNOWN";
  const presentation = pushPresentationForType(eventType, title, body);
  title = presentation.title;
  body = presentation.body;
  data.eventType ??= eventType;
  data.notificationRoute ??= pushRouteForType(eventType);
  try {
    const notificationId = eventType === 'OFFER_CLOSED' || data.internalNotificationId ? undefined : await persistUserNotification({ userId, title, message: body, type: eventType, data });
    if (notificationId) data.internalNotificationId = notificationId;
  } catch (error) {
    console.warn("No se pudo guardar la notificación interna.", {
      type: eventType,
      code: firebaseErrorCode(error)
    });
    captureOperationalError(error, { operation: "internal_notification_persist", eventType });
  }
  const finish = async (result: PushResult): Promise<PushResult> => {
    await recordPushDelivery({
      userId,
      tripId: data.tripId,
      eventType,
      status: pushDeliveryStatus(result),
      attempted: result.attempted,
      sent: result.sent,
      failed: result.failed,
      errorCodes: [...new Set([...(result.errors?.map(value => value.code) ?? []), ...(result.errorCode ? [result.errorCode] : [])])],
      durationMs: Math.round(performance.now() - startedAt)
    });
    return result;
  };
  try {
    const client = messaging();
    if (!client) {
      console.warn("Push omitido: FIREBASE_SERVICE_ACCOUNT_BASE64 no está configurado.");
      return finish({ sent: 0, skipped: true, errorCode: "firebase/not-configured" });
    }
    const rows = await database()`
      select distinct device.id::text,device.device_id as "deviceId",device.token, device.notification_protocol as protocol, device.platform, account.role::text as "userType"
      from device_tokens device
      join users account on account.id=device.user_id
      where device.user_id=${userId} and device.last_seen_at > now() - interval '90 days'
        and device.enabled=true and device.invalidated_at is null
        and (device.session_id is null or device.session_id=account.active_session_id)
        and not(coalesce(device.device_id,'')=any(${options.excludeDeviceIds??[]}::text[]))
    `;
    if (rows[0]?.userType) data.userType ??= String(rows[0].userType);
    const tokens = rows.map(row => String(row.token));
    if (!tokens.length) {
      console.warn("Push omitido: el usuario no tiene un dispositivo registrado.", { type: data.type ?? "unknown" });
      return finish({ sent: 0, attempted: 0, errorCode: "firebase/device-not-registered" });
    }
    const isChat = data.type === "CHAT_MESSAGE";
    const isTripOffer = data.type === "TRIP_OFFER";
    const isDriverArrival = data.type === "DRIVER_ARRIVED";
    if (isTripOffer) {
      const [offer] = await database()`select o.expires_at from driver_offers o join trips t on t.id=o.trip_id
        where o.trip_id=${data.tripId!} and o.driver_id=${userId} and o.responded_at is null and o.expires_at>now() and t.status='SEARCHING'`;
      if (!offer) return finish({sent:0, skipped:true, errorCode:'offer/expired'});
      data.expiresAt=new Date(offer.expires_at).toISOString();
    }
    data.title=title; data.body=body;
    const notificationTag = options.collapseKey ?? (data.tripId
      ? `${isChat ? "chat" : "trip"}-${data.tripId}`
      : `costa-go-${data.type ?? "general"}`);
    const ttl = Math.max(0, options.expiresAt
      ? options.expiresAt.getTime()-Date.now()
      : isTripOffer ? new Date(data.expiresAt!).getTime()-Date.now() : isChat ? 86_400_000 : 900_000);
    // Older APKs keep their existing FCM presentation. Protocol 2 owns offer
    // rendering/dismissal in a native bridge registered with the headless engine.
    const result = await client.sendEach(rows.map(device => {
      const lifecycle = Number(device.protocol)>=2 && device.platform==='ANDROID' && ['TRIP_OFFER','TRIP_OFFER_CANCELLED','TRIP_CANCELLED','OFFER_CLOSED'].includes(eventType);
      const silent = eventType==='OFFER_CLOSED';
      return {
      token: String(device.token),
      ...(!lifecycle && !silent ? {notification: { title, body }} : {}),
      data,
      android: {
        priority: (options.priority==='PROMOTIONAL'||options.priority==='CAMPAIGN') ? "normal" as const : "high" as const,
        collapseKey: silent ? `close-${data.tripId}` : notificationTag,
        ttl,
        ...(!lifecycle && !silent ? {notification: {
          channelId: isChat
            ? "costa_go_chat_v2"
            : isTripOffer
              ? "costa_go_trip_offers_v3"
              : isDriverArrival
                ? "costa_go_driver_arrival_v2"
              : "costa_go_trip_updates_v2",
          tag: notificationTag,
          priority: isTripOffer ? "max" as const : "high" as const,
          icon: "ic_notification",
          color: "#00AEEF",
          sound: "default",
          defaultVibrateTimings: true,
          visibility: "private" as const,
        }} : {})
      },
      apns: {
        headers: { "apns-priority": silent ? "5" : "10", "apns-push-type": silent ? "background" : "alert" },
        payload: {
          aps: {
            ...(silent ? {contentAvailable:true} : {sound:"default", alert:{title,body}}),
            badge: 1,
            category: data.notificationRoute,
            threadId: notificationTag
          }
        }
      }
    }; }));
    const invalid = result.responses.flatMap((response, index) =>
      !response.success && ["messaging/registration-token-not-registered", "messaging/invalid-registration-token"].includes(response.error?.code ?? "")
        ? [{token:tokens[index]!,code:response.error?.code??'messaging/invalid-registration-token'}]
        : []
    );
    for(const entry of invalid)await database()`update device_tokens set enabled=false,invalidated_at=now(),invalidated_reason='PROVIDER_REJECTED',provider_error_code=${entry.code},updated_at=now() where token=${entry.token}`;
    const errors = result.responses
      .filter(response => !response.success)
      .map(response => ({ code: response.error?.code ?? "unknown", message: response.error?.message ?? "" }));
    if (result.failureCount) console.warn("Firebase rechazó una o más notificaciones.", errors.map(error => error.code));
    const durationMs = Math.round(performance.now() - startedAt);
    console.info("Push procesado.", {
      type: data.type ?? "unknown",
      attempted: tokens.length,
      sent: result.successCount,
      failed: result.failureCount,
      durationMs
    });
    const deliveries=result.responses.map((response,index)=>({deviceTokenId:String(rows[index]!.id),...(rows[index]!.deviceId?{deviceId:String(rows[index]!.deviceId)}:{}),success:response.success,...(!response.success?{code:response.error?.code??'unknown'}:{})}));
    return finish({ sent: result.successCount, attempted: tokens.length, failed: result.failureCount, errors, durationMs,deliveries });
  } catch (error) {
    console.error("Firebase no pudo enviar la notificación.", {
      type: data.type ?? "unknown",
      code: firebaseErrorCode(error),
      error: error instanceof Error ? error.message : String(error)
    });
    captureOperationalError(error, { operation: "firebase_send", eventType });
    return finish({ sent: 0, attempted: 0, failed: 0, errorCode: firebaseErrorCode(error) });
  }
}
