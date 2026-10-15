import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendText, isGreenApiConfigured } from "@/lib/whatsapp/green-api";
import { addProductToLead } from "@/lib/products";
import { chatIdFromPhone, normalizeMxPhone } from "@/lib/utils";
import type { Lead } from "@/lib/types";

export const IntakeSchema = z.object({
  full_name: z.string().trim().min(3, "Escribe tu nombre completo"),
  phone: z
    .string()
    .trim()
    .refine((p) => p.replace(/\D/g, "").length >= 10, "Escribe un teléfono de 10 dígitos"),
  email: z.string().trim().email("Correo inválido").optional().or(z.literal("")),
  curp: z.string().trim().toUpperCase().optional().or(z.literal("")),
  nss: z.string().trim().optional().or(z.literal("")),
  /** Un producto (compatibilidad); para varios usa "products" */
  tramite_type: z.string().trim().optional().or(z.literal("")),
  /** Productos que le interesan (nombres del catálogo) */
  products: z.array(z.string().trim().min(1)).default([]),
  message: z.string().trim().max(2000).optional().or(z.literal("")),
  source: z.string().default("formulario"),
  utm: z.record(z.string(), z.string()).default({}),
  extra: z.record(z.string(), z.unknown()).default({}),
  /** Enviar un primer mensaje por WhatsApp al prospecto (útil para Facebook Lead Ads) */
  send_whatsapp: z.boolean().default(false),
});

export type IntakeInput = z.input<typeof IntakeSchema>;

/** Crea o actualiza un lead desde un formulario / integración externa. */
export async function upsertLeadFromIntake(input: z.output<typeof IntakeSchema>): Promise<Lead> {
  const db = createAdminClient();
  const phone = normalizeMxPhone(input.phone);
  const form_data = {
    ...input.extra,
    ...(input.message ? { mensaje: input.message } : {}),
    enviado_en: new Date().toISOString(),
  };

  const fields = {
    full_name: input.full_name,
    email: input.email || null,
    curp: input.curp || null,
    nss: input.nss ? input.nss.replace(/\D/g, "") : null,
  };
  const products = [...new Set([...input.products, ...(input.tramite_type ? [input.tramite_type] : [])])];

  const { data: matches } = await db
    .from("leads")
    .select("*")
    .like("phone", `%${phone.slice(-10)}`)
    .order("created_at", { ascending: false })
    .limit(1);
  const existing = (matches?.[0] as Lead | undefined) ?? null;

  let lead: Lead;
  if (existing) {
    const merged = Object.fromEntries(Object.entries(fields).filter(([, v]) => v)) as Partial<Lead>;
    const { data } = await db
      .from("leads")
      .update({ ...merged, form_data: { ...existing.form_data, ...form_data }, utm: { ...existing.utm, ...input.utm } })
      .eq("id", existing.id)
      .select("*")
      .single<Lead>();
    lead = data!;
    await db.from("activities").insert({ lead_id: lead.id, kind: "system", content: `Formulario reenviado (${input.source})` });
  } else {
    const { data, error } = await db
      .from("leads")
      .insert({ ...fields, phone, source: input.source, utm: input.utm, form_data, status: "nuevo" })
      .select("*")
      .single<Lead>();
    if (error) throw new Error(error.message);
    lead = data!;
    await db.from("activities").insert({ lead_id: lead.id, kind: "system", content: `Registro recibido por ${input.source}` });
  }

  // Cada producto queda como "pidió información"; el agente lo marca como registrado al completar sus datos
  for (const product of products) {
    const r = await addProductToLead(db, lead.id, product, "interesado");
    if (r.error) console.error("[intake] no se pudo agregar el producto", product, r.error);
  }

  if (input.send_whatsapp && isGreenApiConfigured()) {
    const chatId = chatIdFromPhone(phone);
    const first = lead.full_name?.split(" ")[0] ?? "";
    const text = `¡Hola ${first}! 👋 Recibimos tu registro (folio *${lead.folio}*). Soy el asistente virtual y te ayudaré a dar seguimiento a tu trámite. ${products.length ? `Vi que te interesa: *${products.join(", ")}*. ¿Te cuento cómo funciona?` : "¿Me confirmas qué trámite necesitas?"}`;
    try {
      const idMessage = await sendText(chatId, text);
      await db.from("leads").update({ wa_chat_id: chatId, last_message_at: new Date().toISOString() }).eq("id", lead.id);
      await db.from("messages").insert({
        lead_id: lead.id,
        direction: "out",
        sender: "ai",
        type: "text",
        body: text,
        wa_message_id: idMessage,
        status: "sent",
      });
    } catch (e) {
      console.error("[intake] no se pudo enviar WhatsApp", e);
    }
  }

  return lead;
}
