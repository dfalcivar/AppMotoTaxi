import { randomUUID } from "node:crypto";
import { database } from "./database.js";

export type MeteredGoogleProvider = "ROUTES" | "GEOCODING";

export interface GoogleApiUsageEvent {
  provider: MeteredGoogleProvider;
  result: "SUCCESS" | "HTTP_ERROR" | "NETWORK_ERROR";
  metadata?: Record<string, string | number | boolean | null>;
}
export type GoogleApiUsageRecorder = (event: GoogleApiUsageEvent) => Promise<void> | void;

interface GoogleApiUsageContext {
  userId?: string;
  tripId?: string;
  serviceAreaId?: string;
  cooperativeId?: string;
  phase?: string;
}

/** Records only real outbound Google requests and never interrupts the user flow. */
export function googleApiUsageRecorder(context: GoogleApiUsageContext = {}): GoogleApiUsageRecorder {
  return async event => {
    try {
      await database()`insert into api_usage_events(
        provider,environment,billing_period,trip_id,user_id,service_area_id,cooperative_id,
        phase,request_key,result,metadata
      ) values (
        ${event.provider},${process.env.NODE_ENV === "production" ? "PRODUCTION" : "TEST"},
        date_trunc('month',now())::date,${context.tripId ?? null},${context.userId ?? null},
        ${context.serviceAreaId ?? null},${context.cooperativeId ?? null},${context.phase ?? null},
        ${`server:${event.provider.toLowerCase()}:${randomUUID()}`},${event.result},
        ${JSON.stringify(event.metadata ?? {})}::jsonb
      )`;
    } catch {
      // La medición no debe impedir solicitar, aceptar o completar un viaje.
    }
  };
}
