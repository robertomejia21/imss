/**
 * Datos del responsable para el aviso de privacidad y los mensajes del agente.
 * Domicilio y correo se pueden cambiar con variables de entorno (COMPANY_ADDRESS, PRIVACY_EMAIL).
 */
export const COMPANY = {
  name: process.env.PAYMENT_BUSINESS_NAME ?? "L&S Consultores Asociados AC",
  address: process.env.COMPANY_ADDRESS?.trim() || "Casiterita 1980, Valle de Pedregal, Mexicali, Baja California",
  privacyEmail: process.env.PRIVACY_EMAIL?.trim() || "leonardoimss2020@gmail.com",
  whatsapp: process.env.NEXT_PUBLIC_WHATSAPP_NUMBER?.trim() || null,
  // Correo de la empresa con el que registramos al cliente en el IMSS (Alta en IMSS y préstamo vía nómina)
  tramiteEmail: process.env.TRAMITE_EMAIL?.trim() || "leonardoimss2020@gmail.com",
};

const NAME_PARTICLES = new Set(["de", "del", "la", "las", "los", "y", "da", "di", "van", "von", "mc"]);

/**
 * Correo del trámite: el de la empresa con un alias "+nombre e iniciales de apellidos".
 * "Roberto Méndez Robles" → leonardoimss2020+robertomr@gmail.com. `suffix` distingue homónimos (ej. "2012" = 20 de diciembre).
 */
export function tramiteEmailFor(fullName: string, suffix = "") {
  const words = fullName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !NAME_PARTICLES.has(w));
  if (!words.length) return null;
  // En México los dos últimos son los apellidos; el primero es el nombre de pila
  const surnames = words.length >= 3 ? words.slice(-2) : words.slice(1);
  const alias = `${words[0]}${surnames.map((s) => s[0]).join("")}${suffix}`;
  const [local, domain] = COMPANY.tramiteEmail.split("@");
  return `${local}+${alias}@${domain}`;
}

const PRODUCTION_URL = "https://imss-lac.vercel.app";

/** URL pública de la app (la de producción si NEXT_PUBLIC_APP_URL no es https). */
export function appUrl() {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return base?.startsWith("https://") ? base.replace(/\/$/, "") : PRODUCTION_URL;
}

/** URL pública del aviso de privacidad (la que el agente envía por WhatsApp). */
export const privacyUrl = () => `${appUrl()}/aviso-de-privacidad`;
