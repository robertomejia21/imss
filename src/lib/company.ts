/**
 * Datos del responsable para el aviso de privacidad y los mensajes del agente.
 * Domicilio y correo de privacidad se configuran con variables de entorno
 * (COMPANY_ADDRESS, PRIVACY_EMAIL); mientras falten, el aviso remite al WhatsApp.
 */
export const COMPANY = {
  name: process.env.PAYMENT_BUSINESS_NAME ?? "L&S Consultores Asociados AC",
  address: process.env.COMPANY_ADDRESS?.trim() || null,
  privacyEmail: process.env.PRIVACY_EMAIL?.trim() || null,
  whatsapp: process.env.NEXT_PUBLIC_WHATSAPP_NUMBER?.trim() || null,
};

const PRODUCTION_URL = "https://imss-lac.vercel.app";

/** URL pública del aviso de privacidad (la que el agente envía por WhatsApp). */
export function privacyUrl() {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return `${base?.startsWith("https://") ? base.replace(/\/$/, "") : PRODUCTION_URL}/aviso-de-privacidad`;
}
