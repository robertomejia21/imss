"use server";

import { redirect } from "next/navigation";
import { IntakeSchema, upsertLeadFromIntake } from "@/lib/leads";

export type RegistroState = { errors?: Record<string, string[] | undefined>; error?: string } | undefined;

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "ad_id"];

export async function submitRegistro(_prev: RegistroState, formData: FormData): Promise<RegistroState> {
  if (formData.get("company")) return { error: "Error" }; // honeypot anti-bots
  if (formData.get("privacy") !== "on") return { errors: { privacy: ["Debes aceptar el aviso de privacidad"] } };

  const utm: Record<string, string> = {};
  for (const k of UTM_KEYS) {
    const v = formData.get(k);
    if (typeof v === "string" && v) utm[k] = v.slice(0, 200);
  }

  const parsed = IntakeSchema.safeParse({
    full_name: formData.get("full_name"),
    phone: formData.get("phone"),
    email: formData.get("email") ?? "",
    curp: formData.get("curp") ?? "",
    nss: formData.get("nss") ?? "",
    tramite_type: formData.get("tramite_type") ?? "",
    message: formData.get("message") ?? "",
    source: utm.utm_source?.toLowerCase().includes("facebook") || utm.fbclid ? "facebook" : "formulario",
    utm,
    extra: { ciudad: String(formData.get("city") ?? "") || undefined },
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  let folio: string;
  try {
    folio = (await upsertLeadFromIntake(parsed.data)).folio;
  } catch {
    return { error: "No pudimos guardar tu registro. Intenta de nuevo." };
  }
  redirect(`/registro/gracias?folio=${encodeURIComponent(folio)}&n=${encodeURIComponent(parsed.data.full_name.split(" ")[0] ?? "")}`);
}
