/**
 * Datos del responsable para el aviso de privacidad y los mensajes del agente.
 * Domicilio y correo se pueden cambiar con variables de entorno (COMPANY_ADDRESS, PRIVACY_EMAIL).
 */
export const COMPANY = {
  name: process.env.PAYMENT_BUSINESS_NAME ?? "L&S Consultores Asociados AC",
  address: process.env.COMPANY_ADDRESS?.trim() || "Casiterita 1980, Valle de Pedregal, Mexicali, Baja California",
  privacyEmail: process.env.PRIVACY_EMAIL?.trim() || "leonardoimss2020@gmail.com",
  whatsapp: process.env.NEXT_PUBLIC_WHATSAPP_NUMBER?.trim() || null,
};

const PRODUCTION_URL = "https://imss-lac.vercel.app";

/** URL pública de la app (la de producción si NEXT_PUBLIC_APP_URL no es https). */
export function appUrl() {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return base?.startsWith("https://") ? base.replace(/\/$/, "") : PRODUCTION_URL;
}

/** URL pública del aviso de privacidad (la que el agente envía por WhatsApp). */
export const privacyUrl = () => `${appUrl()}/aviso-de-privacidad`;
