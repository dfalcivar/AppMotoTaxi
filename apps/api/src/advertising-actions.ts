export type AdvertisingActionType = "WEB" | "PHONE" | "WHATSAPP" | "MAPS" | "NONE";
export const DEFAULT_WHATSAPP_ADVERTISING_MESSAGE = "Hola, vi su publicidad en Costa-Go y deseo más información.";

function whatsappDigits(value: string): string {
  const input = value.trim();
  if (!input) throw new Error("WHATSAPP_NUMBER_REQUIRED");

  let candidate = input;
  if (/^https?:\/\//i.test(input)) {
    const url = new URL(input);
    if (url.hostname.toLowerCase() === "wa.me") candidate = url.pathname;
    else if (["api.whatsapp.com", "www.api.whatsapp.com"].includes(url.hostname.toLowerCase())) candidate = url.searchParams.get("phone") ?? "";
    else throw new Error("INVALID_WHATSAPP_NUMBER");
  } else if (!/^[+\d\s().-]+$/.test(input)) {
    throw new Error("INVALID_WHATSAPP_NUMBER");
  }

  let digits = candidate.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 10) digits = `593${digits.slice(1)}`;
  else if (digits.length === 9 && digits.startsWith("9")) digits = `593${digits}`;

  if (!/^\d{10,15}$/.test(digits)) throw new Error("INVALID_WHATSAPP_NUMBER");
  return digits;
}

export function normalizeAdvertisingActionValue(type: AdvertisingActionType, value?: string | null): string | null {
  if (type === "NONE") return null;
  const input = value?.trim() ?? "";
  if (type === "WHATSAPP") return `https://wa.me/${whatsappDigits(input)}`;
  return input || null;
}

export function normalizeAdvertisingActionMessage(type: AdvertisingActionType, message?: string | null): string | null {
  if (type !== "WHATSAPP") return null;
  return message?.trim() || DEFAULT_WHATSAPP_ADVERTISING_MESSAGE;
}

export function composeAdvertisingActionValue(type: AdvertisingActionType, value?: string | null, message?: string | null): string | null {
  const normalized = normalizeAdvertisingActionValue(type, value);
  if (type !== "WHATSAPP" || !normalized) return normalized;
  const url = new URL(normalized);
  url.searchParams.set("text", normalizeAdvertisingActionMessage(type, message)!);
  return url.toString();
}
