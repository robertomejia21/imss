import clsx, { type ClassValue } from "clsx";

export const cn = (...inputs: ClassValue[]) => clsx(inputs);

/** Deja solo dígitos. "+52 1 55-1234-5678" → "5215512345678" */
export const digits = (s: string) => s.replace(/\D/g, "");

/** Normaliza un teléfono mexicano a formato WhatsApp (521 + 10 dígitos). */
export function normalizeMxPhone(input: string): string {
  const d = digits(input);
  if (d.length === 10) return `521${d}`;
  if (d.length === 12 && d.startsWith("52")) return `521${d.slice(2)}`;
  return d;
}

export const chatIdFromPhone = (phone: string) => `${digits(phone)}@c.us`;
export const phoneFromChatId = (chatId: string) => chatId.split("@")[0];

export function formatPhone(phone: string | null) {
  if (!phone) return "—";
  const d = digits(phone);
  const local = d.slice(-10);
  if (local.length !== 10) return phone;
  return `+${d.slice(0, d.length - 10)} ${local.slice(0, 2)} ${local.slice(2, 6)} ${local.slice(6)}`;
}

const rtf = new Intl.RelativeTimeFormat("es-MX", { numeric: "auto" });

export function timeAgo(iso: string | null) {
  if (!iso) return "—";
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return "ahora";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), "day");
  return formatDate(iso);
}

export const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export const formatDateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";

export const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });

export const displayName = (l: { full_name: string | null; wa_name: string | null; phone: string | null }) =>
  l.full_name || l.wa_name || formatPhone(l.phone);

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /[a-záéíóúñ]/i.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

// ---------- Validaciones de identificadores mexicanos ----------
export const CURP_RE = /^[A-Z][AEIOUX][A-Z]{2}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[HMX](AS|BC|BS|CC|CL|CM|CS|CH|DF|DG|GT|GR|HG|JC|MC|MN|MS|NT|NL|OC|PL|QT|QR|SP|SL|SR|TC|TS|TL|VZ|YN|ZS|NE)[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d$/;

export function isValidCurp(curp: string) {
  const c = curp.toUpperCase().trim();
  if (!CURP_RE.test(c)) return false;
  // Dígito verificador
  const dict = "0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ";
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += dict.indexOf(c[i]!) * (18 - i);
  const check = (10 - (sum % 10)) % 10;
  return check === Number(c[17]);
}

/** NSS: 11 dígitos con verificador Luhn. */
export function isValidNss(nss: string) {
  const d = digits(nss);
  if (d.length !== 11) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let n = Number(d[i]) * (i % 2 === 0 ? 1 : 2);
    if (n > 9) n -= 9;
    sum += n;
  }
  return (10 - (sum % 10)) % 10 === Number(d[10]);
}
