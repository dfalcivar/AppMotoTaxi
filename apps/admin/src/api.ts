export type Zone = "URBAN" | "EXTENDED";
export type AdminRole = "ADMIN" | "SUPPORT" | "SUPER_ADMIN" | "ADMIN_OPERACIONES" | "SOPORTE" | "ANALISTA_COOPERATIVA" | "COLLECTOR" | "FINANCE" | "COMMERCIAL";
export interface SessionUser {
  id?: string;
  email: string;
  name: string;
  role: AdminRole;
  permissions: string[];
  cooperativeId?: string;
  mustChangePassword?: boolean;
  expiresAt?: number;
}
export interface Session { token: string; user: SessionUser }
export interface QuoteRequest { zone: Zone; passengers: number; localTime: string }
export interface Quote { currency: "USD"; totalCents: number; total: string; period: "DAY" | "NIGHT"; zone: Zone; passengers: number; appliedRule: string; pricingVersion: number; explanation: string }
import { captureAdminError } from "./observability.js";

const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "/api";
export function apiUrl(path: string) { return `${base}${path}`; }
function persistentPath(path: string, method?: string): string {
  if (method === "POST" && path === "/v1/admin/pricing") return "/v1/admin/pricing/persist";
  if (method === "PATCH" && /^\/v1\/admin\/incidents\/[^/]+$/.test(path)) return `${path}/persist`;
  return path;
}
async function parse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
    const raw=body.message ?? body.error ?? `Error HTTP ${response.status}`;
    const message=/constraint|SQL|relation "|syntax error|column .*does not exist|FROM-clause|database.*error/i.test(raw)
      ? "No fue posible completar la operación. Intenta nuevamente o contacta soporte."
      : ({FORBIDDEN:"Tu usuario no tiene permiso para realizar esta acción.",DATABASE_UNAVAILABLE:"La base de datos no está disponible temporalmente. Intenta nuevamente.",INVALID_DATA:"Revisa los datos ingresados antes de continuar.",UNAUTHORIZED:"La sesión no es válida. Vuelve a ingresar."} as Record<string,string>)[raw] ?? raw;
    throw Object.assign(new Error(message),{code:body.error});
  }
  return response.json() as Promise<T>;
}
export async function apiFetch<T>(path: string, token?: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  try {
    const response=await fetcher(`${base}${persistentPath(path, init.method)}`, { ...init, headers });
    if(response.status===401&&path!=="/v1/admin/session"&&typeof window!=="undefined")window.dispatchEvent(new CustomEvent("admin-session-expired"));
    return parse<T>(response);
  } catch (error) {
    if (error instanceof TypeError) {
      captureAdminError(error, { path, method: init.method ?? "GET", kind: "network" });
      throw new Error("No se pudo conectar con la API de Render. Intenta nuevamente en unos segundos.");
    }
    throw error;
  }
}
export function login(email: string, password: string) { return apiFetch<Session>("/v1/admin/session", undefined, { method: "POST", body: JSON.stringify({ email, password }) }); }
export function changeAdminPassword(token: string, password: string) { return apiFetch<Session>("/v1/admin/change-password", token, { method: "POST", body: JSON.stringify({ password }) }); }
export async function requestQuote(input: QuoteRequest, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<Quote> {
  return apiFetch<Quote>("/v1/quotes", undefined, { method: "POST", body: JSON.stringify(input), signal }, fetcher);
}
