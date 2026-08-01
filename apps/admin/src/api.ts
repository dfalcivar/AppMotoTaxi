export type Zone = "URBAN" | "EXTENDED";
export type AdminRole = "ADMIN" | "SUPPORT";
export interface SessionUser { email: string; name: string; role: AdminRole }
export interface Session { token: string; user: SessionUser }
export interface QuoteRequest { zone: Zone; passengers: number; localTime: string }
export interface Quote { currency: "USD"; totalCents: number; total: string; period: "DAY" | "NIGHT"; zone: Zone; passengers: number; appliedRule: string; pricingVersion: number; explanation: string }

const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "/api";
function persistentPath(path: string, method?: string): string {
  if (method === "POST" && path === "/v1/admin/pricing") return "/v1/admin/pricing/persist";
  if (method === "POST" && path === "/v1/admin/zones") return "/v1/admin/zones/persist";
  if (method === "PATCH" && /^\/v1\/admin\/incidents\/[^/]+$/.test(path)) return `${path}/persist`;
  return path;
}
async function parse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
    throw new Error(body.message ?? body.error ?? `Error HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}
export async function apiFetch<T>(path: string, token?: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  try {
    return parse<T>(await fetcher(`${base}${persistentPath(path, init.method)}`, { ...init, headers }));
  } catch (error) {
    if (error instanceof TypeError) throw new Error("No se pudo conectar con la API de Render. Intenta nuevamente en unos segundos.");
    throw error;
  }
}
export function login(email: string, password: string) { return apiFetch<Session>("/v1/admin/session", undefined, { method: "POST", body: JSON.stringify({ email, password }) }); }
export async function requestQuote(input: QuoteRequest, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<Quote> {
  return apiFetch<Quote>("/v1/quotes", undefined, { method: "POST", body: JSON.stringify(input), signal }, fetcher);
}
