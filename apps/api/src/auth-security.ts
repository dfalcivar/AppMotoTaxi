import { z } from "zod";

export const passwordPolicyMessage =
  "Usa entre 10 y 100 caracteres, con mayúscula, minúscula, número y símbolo.";

const commonPasswords = new Set([
  "12345678",
  "123456789",
  "1234567890",
  "password",
  "contraseña",
  "contrasena",
  "qwerty123",
  "admin123",
]);

export function isStrongPassword(value: string): boolean {
  if (value.length < 10 || value.length > 100) return false;
  if (/\s/.test(value)) return false;
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value)) return false;
  if (!/\d/.test(value) || !/[^A-Za-z0-9\s]/.test(value)) return false;
  return !commonPasswords.has(value.toLocaleLowerCase("es"));
}

export const strongPasswordSchema = z
  .string()
  .min(10)
  .max(100)
  .refine(isStrongPassword, { message: "WEAK_PASSWORD" });

export function normalizeEmail(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

export function normalizePhone(value: string): string | null {
  const compact = value.trim().replace(/[\s().-]/g, "");
  if (/^\+593\d{9}$/.test(compact)) return compact;
  if (/^593\d{9}$/.test(compact)) return `+${compact}`;
  if (/^0\d{9}$/.test(compact)) return `+593${compact.slice(1)}`;
  if (/^9\d{8}$/.test(compact)) return `+593${compact}`;
  if (/^\+[1-9]\d{7,14}$/.test(compact)) return compact;
  return null;
}

export function legacyPhoneAliases(normalizedPhone: string): string[] {
  const aliases = new Set([normalizedPhone]);
  if (normalizedPhone.startsWith("+593") && normalizedPhone.length === 13) {
    const local = `0${normalizedPhone.slice(4)}`;
    aliases.add(local);
    aliases.add(`+${local}`);
    aliases.add(normalizedPhone.slice(1));
  }
  return [...aliases];
}
