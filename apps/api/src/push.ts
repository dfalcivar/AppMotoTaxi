import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { HttpsProxyAgent } from "https-proxy-agent";
import { database } from "./database.js";

// La API se inicia desde la raíz del monorepo; la credencial siempre vive junto
// a esta aplicación, sin depender del directorio desde el que se ejecute Node.
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

export async function sendPush(userId: string, title: string, body: string, data: Record<string, string> = {}) {
  const client = messaging();
  if (!client) {
    console.warn("Push omitido: FIREBASE_SERVICE_ACCOUNT_BASE64 no está configurado.");
    return { sent: 0, skipped: true };
  }
  const rows = await database()`select token from device_tokens where user_id=${userId} and last_seen_at > now() - interval '90 days'`;
  const tokens = rows.map(row => String(row.token));
  if (!tokens.length) {
    console.warn(`Push omitido: el usuario ${userId} no tiene un dispositivo registrado.`);
    return { sent: 0, attempted: 0 };
  }
  const result = await client.sendEachForMulticast({ tokens, notification: { title, body }, data, android: { priority: "high" } });
  const invalid = result.responses.flatMap((response, index) => !response.success && ["messaging/registration-token-not-registered", "messaging/invalid-registration-token"].includes(response.error?.code ?? "") ? [tokens[index]!] : []);
  if (invalid.length) await database()`delete from device_tokens where token = any(${invalid})`;
  if (result.failureCount) console.warn("Firebase rechazó una o más notificaciones.", result.responses.filter(response => !response.success).map(response => response.error?.code ?? "unknown"));
  return { sent: result.successCount, attempted: tokens.length, failed: result.failureCount, errors: result.responses.filter(response => !response.success).map(response => ({ code: response.error?.code ?? "unknown", message: response.error?.message ?? "" })) };
}
