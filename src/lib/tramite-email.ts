import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { COMPANY, tramiteEmailFor } from "@/lib/company";
import { cdmxDate } from "@/lib/payments";
import type { Lead } from "@/lib/types";

export type TramiteEmailResult = { email: string; existing: boolean } | { error: string };

/**
 * Genera y guarda el correo del trámite del prospecto (correo de la empresa + alias de su nombre).
 * Si ya tiene uno, lo devuelve sin generar otro. Lo usan la IA y el botón del CRM.
 */
export async function assignTramiteEmail(
  db: SupabaseClient,
  lead: Pick<Lead, "id" | "full_name" | "email" | "captured_data">,
): Promise<TramiteEmailResult> {
  if (!lead.full_name) return { error: "Falta su nombre completo." };
  const domain = COMPANY.tramiteEmail.split("@")[1];
  if (lead.email && lead.captured_data?.correo_tramite === lead.email && lead.email.endsWith(`@${domain}`)) {
    return { email: lead.email, existing: true };
  }
  // Homónimos: cada cliente necesita su propio correo en el portal del IMSS.
  // Primero sin sufijo; si ya existe, día y mes de hoy (ej. "2012" = 20 de diciembre); si también, "-2", "-3"…
  const [, mm, dd] = cdmxDate(new Date()).split("-");
  const ddmm = `${dd}${mm}`;
  const suffixes = ["", ddmm, ...Array.from({ length: 18 }, (_, i) => `${ddmm}-${i + 2}`)];
  let email: string | null = null;
  for (const suffix of suffixes) {
    const candidate = tramiteEmailFor(lead.full_name, suffix);
    if (!candidate) break;
    const { count } = await db.from("leads").select("id", { count: "exact", head: true }).eq("email", candidate).neq("id", lead.id);
    if (!count) {
      email = candidate;
      break;
    }
  }
  if (!email) return { error: "No se pudo generar el correo con su nombre." };
  // Si ya tenía un correo propio, se conserva aparte para no perderlo
  const personal = lead.email && !lead.captured_data?.correo_personal ? { correo_personal: lead.email } : {};
  const captured = { ...lead.captured_data, ...personal, correo_tramite: email };
  const { error } = await db.from("leads").update({ email, captured_data: captured }).eq("id", lead.id);
  if (error) return { error: `Error al guardar el correo: ${error.message}` };
  lead.email = email;
  lead.captured_data = captured;
  return { email, existing: false };
}
