import * as Sentry from "@sentry/react";

const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim();

if (dsn) {
  Sentry.init({
    dsn,
    environment: (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) ?? import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE as string | undefined,
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 0.05),
    sendDefaultPii: false
  });
}

export const AdminErrorBoundary = Sentry.ErrorBoundary;

export function captureAdminError(error: unknown, context: Record<string, unknown> = {}): void {
  if (!dsn) return;
  Sentry.withScope(scope => {
    for (const [key, value] of Object.entries(context)) scope.setExtra(key, value);
    Sentry.captureException(error);
  });
}

