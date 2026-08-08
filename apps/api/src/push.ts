import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { HttpsProxyAgent } from "https-proxy-agent";
import { database } from "./database.js";

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

export function pushConfigurationStatus(clientProjectId?: string) {
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

export async function sendPush(userId: string, title: string, body: string, data: Record<string, string> = {}) {
  const startedAt = performance.now();
  try {
    const client = messaging();
    if (!client) {
      console.warn("Push omitido: FIREBASE_SERVICE_ACCOUNT_BASE64 no está configurado.");
      return { sent: 0, skipped: true, errorCode: "firebase/not-configured" };
    }
    const rows = await database()`select distinct token from device_tokens where user_id=${userId} and last_seen_at > now() - interval '90 days'`;
    const tokens = rows.map(row => String(row.token));
    if (!tokens.length) {
      console.warn("Push omitido: el usuario no tiene un dispositivo registrado.", { type: data.type ?? "unknown" });
      return { sent: 0, attempted: 0, errorCode: "firebase/device-not-registered" };
    }
    const isChat = data.type === "CHAT_MESSAGE";
    const isTripOffer = data.type === "TRIP_OFFER";
    const notificationTag = data.tripId
      ? `${isChat ? "chat" : "trip"}-${data.tripId}`
      : `atacamesgo-${data.type ?? "general"}`;
    const ttl = data.type === "TRIP_OFFER" ? 120_000 : isChat ? 86_400_000 : 900_000;
    const result = await client.sendEachForMulticast({
      tokens,
      notification: { title, body },
      data,
      android: {
        priority: "high",
        collapseKey: notificationTag,
        ttl,
        notification: {
          channelId: isChat
            ? "mototaxi_chat_messages_v2"
            : isTripOffer
              ? "mototaxi_trip_offers_v2"
              : "mototaxi_trip_alerts_v4",
          tag: notificationTag,
          priority: isTripOffer ? "max" : "high",
          sound: "default",
          defaultVibrateTimings: true,
          visibility: "public"
        }
      },
      apns: {
        headers: { "apns-priority": "10", "apns-push-type": "alert" },
        payload: {
          aps: {
            sound: "default",
            badge: 1,
            category: isTripOffer ? "TRIP_OFFER" : "TRIP_UPDATE",
            threadId: notificationTag
          }
        }
      }
    });
    const invalid = result.responses.flatMap((response, index) =>
      !response.success && ["messaging/registration-token-not-registered", "messaging/invalid-registration-token"].includes(response.error?.code ?? "")
        ? [tokens[index]!]
        : []
    );
    if (invalid.length) await database()`delete from device_tokens where token = any(${invalid})`;
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
    return { sent: result.successCount, attempted: tokens.length, failed: result.failureCount, errors, durationMs };
  } catch (error) {
    console.error("Firebase no pudo enviar la notificación.", {
      type: data.type ?? "unknown",
      code: firebaseErrorCode(error),
      error: error instanceof Error ? error.message : String(error)
    });
    return { sent: 0, attempted: 0, failed: 0, errorCode: firebaseErrorCode(error) };
  }
}
