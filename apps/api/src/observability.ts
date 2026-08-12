import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN?.trim();
const environment = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development";
const release = process.env.SENTRY_RELEASE ?? process.env.RENDER_GIT_COMMIT;

function sampleRate(value: string | undefined): number {
  const parsed = Number(value ?? "0.05");
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0.05;
}

if (dsn) {
  Sentry.init({
    dsn,
    environment,
    release,
    tracesSampleRate: sampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE),
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
      }
      return event;
    }
  });
}

export function captureOperationalError(error: unknown, context: Record<string, unknown> = {}): void {
  if (!dsn) return;
  Sentry.withScope(scope => {
    for (const [key, value] of Object.entries(context)) scope.setExtra(key, value);
    Sentry.captureException(error);
  });
}

export async function flushObservability(timeout = 2_000): Promise<boolean> {
  return dsn ? Sentry.flush(timeout) : true;
}

