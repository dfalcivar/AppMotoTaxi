import { buildApp } from "./app.js";
import { captureOperationalError, flushObservability } from "./observability.js";

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";
const app = await buildApp();

try {
  await app.listen({ port, host });
} catch (error) {
  captureOperationalError(error, { stage: "server_start" });
  await flushObservability();
  throw error;
}
