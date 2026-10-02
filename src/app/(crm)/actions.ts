"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStateInstance, isGreenApiConfigured, sendText, setWebhook } from "@/lib/whatsapp/green-api";
import { replyToLead } from "@/lib/ai/agent";
import { leadStatusMeta } from "@/lib/constants";
import { normalizeMxPhone } from "@/lib/utils";
import type { DocumentStatus, LeadStatus, TramiteStatus } from "@/lib/types";

async function auth() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

// ---------- Leads ----------

export async function updateLeadStatus(leadId: string, status: LeadStatus) {
  const { supabase, user } = await auth();
  const { data: lead } = await supabase.from("leads").select("status").eq("id", leadId).single();
  if (!lead || lead.status === status) return;
  await supabase.from("leads").update({ status }).eq("id", leadId);
  await supabase.from("activities").insert({
    lead_id: leadId,
    kind: "status_change",
    content: `Estado: ${leadStatusMeta(lead.status).label} → ${leadStatusMeta(status).label}`,
    created_by: user.id,
  });
  revalidatePath("/", "layout");
}

export async function updateLead(leadId: string, formData: FormData) {
  const { supabase, user } = await auth();
  const update = {
    full_name: str(formData, "full_name"),
    curp: str(formData, "curp")?.toUpperCase() ?? null,
    nss: str(formData, "nss")?.replace(/\D/g, "") ?? null,
    rfc: str(formData, "rfc")?.toUpperCase() ?? null,
    email: str(formData, "email"),
    birth_date: str(formData, "birth_date"),
    tramite_type: str(formData, "tramite_type"),
    assigned_to: str(formData, "assigned_to"),
    notes: str(formData, "notes"),
  };
  await supabase.from("leads").update(update).eq("id", leadId);
  await supabase.from("activities").insert({ lead_id: leadId, kind: "note", content: "Datos del prospecto actualizados", created_by: user.id });
  revalidatePath(`/leads/${leadId}`);
}

export async function createLead(formData: FormData) {
  const { supabase, user } = await auth();
  const phoneRaw = str(formData, "phone");
  const phone = phoneRaw ? normalizeMxPhone(phoneRaw) : null;
  const { data, error } = await supabase
    .from("leads")
    .insert({
      full_name: str(formData, "full_name"),
      phone,
      wa_chat_id: phone ? `${phone}@c.us` : null,
      tramite_type: str(formData, "tramite_type"),
      source: "manual",
      assigned_to: user.id,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message.includes("duplicate") ? "Ya existe un prospecto con ese teléfono" : error.message);
  await supabase.from("activities").insert({ lead_id: data.id, kind: "system", content: "Prospecto creado manualmente", created_by: user.id });
  redirect(`/leads/${data.id}`);
}

export async function setAiEnabled(leadId: string, enabled: boolean) {
  const { supabase, user } = await auth();
  await supabase
    .from("leads")
    .update(enabled ? { ai_enabled: true, needs_human: false, needs_human_reason: null } : { ai_enabled: false })
    .eq("id", leadId);
  await supabase.from("activities").insert({
    lead_id: leadId,
    kind: "ai",
    content: enabled ? "Asistente IA reactivado" : "Asistente IA pausado — atiende un asesor",
    created_by: user.id,
  });
  revalidatePath("/", "layout");
}

export async function resolveHumanRequest(leadId: string) {
  const { supabase } = await auth();
  await supabase.from("leads").update({ needs_human: false, needs_human_reason: null }).eq("id", leadId);
  revalidatePath("/", "layout");
}

export async function markRead(leadId: string) {
  const { supabase } = await auth();
  await supabase.from("leads").update({ unread_count: 0 }).eq("id", leadId).gt("unread_count", 0);
}

export async function addNote(leadId: string, formData: FormData) {
  const { supabase, user } = await auth();
  const content = str(formData, "content");
  if (!content) return;
  await supabase.from("activities").insert({ lead_id: leadId, kind: "note", content, created_by: user.id });
  revalidatePath(`/leads/${leadId}`);
}

// ---------- Mensajes ----------

export async function sendManualMessage(leadId: string, text: string) {
  const { supabase, user } = await auth();
  const body = text.trim();
  if (!body) return { error: "Mensaje vacío" };
  const { data: lead } = await supabase.from("leads").select("wa_chat_id").eq("id", leadId).single();
  if (!lead?.wa_chat_id) return { error: "Este prospecto no tiene WhatsApp vinculado" };
  if (!isGreenApiConfigured()) return { error: "Green API no está configurado" };

  try {
    const idMessage = await sendText(lead.wa_chat_id, body);
    await supabase.from("messages").insert({
      lead_id: leadId,
      direction: "out",
      sender: "agent",
      type: "text",
      body,
      wa_message_id: idMessage,
      status: "sent",
      sent_by: user.id,
    });
    await supabase.from("leads").update({ last_message_at: new Date().toISOString(), unread_count: 0 }).eq("id", leadId);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Pide al agente que responda ahora (por ejemplo después de reactivarlo). */
export async function triggerAiReply(leadId: string) {
  await auth();
  after(() => replyToLead(leadId).catch((e) => console.error("[triggerAiReply]", e)));
}

// ---------- Trámites ----------

export async function createTramite(leadId: string, formData: FormData) {
  const { supabase, user } = await auth();
  const tipo = str(formData, "tipo");
  if (!tipo) return;
  await supabase.from("tramites").insert({
    lead_id: leadId,
    tipo,
    folio_imss: str(formData, "folio_imss"),
    due_date: str(formData, "due_date"),
    notes: str(formData, "notes"),
    created_by: user.id,
  });
  await supabase.from("activities").insert({ lead_id: leadId, kind: "tramite", content: `Trámite creado: ${tipo}`, created_by: user.id });
  const { data: lead } = await supabase.from("leads").select("status").eq("id", leadId).single();
  if (lead && ["nuevo", "en_conversacion", "registro_completo", "documentos_pendientes", "en_revision"].includes(lead.status)) {
    await supabase.from("leads").update({ status: "en_tramite" }).eq("id", leadId);
  }
  revalidatePath(`/leads/${leadId}`);
}

export async function updateTramite(tramiteId: string, leadId: string, formData: FormData) {
  const { supabase, user } = await auth();
  const status = str(formData, "status") as TramiteStatus | null;
  await supabase
    .from("tramites")
    .update({
      status: status ?? undefined,
      folio_imss: str(formData, "folio_imss"),
      due_date: str(formData, "due_date"),
      notes: str(formData, "notes"),
    })
    .eq("id", tramiteId);
  await supabase.from("activities").insert({
    lead_id: leadId,
    kind: "tramite",
    content: `Trámite actualizado${status ? ` → ${status}` : ""}`,
    created_by: user.id,
  });
  revalidatePath(`/leads/${leadId}`);
}

// ---------- Documentos ----------

export async function reviewDocument(documentId: string, status: DocumentStatus, notes?: string) {
  const { supabase, user } = await auth();
  const { data: doc } = await supabase
    .from("documents")
    .update({ status, review_notes: notes ?? null, reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq("id", documentId)
    .select("lead_id, doc_type")
    .single();
  if (doc) {
    await supabase.from("activities").insert({
      lead_id: doc.lead_id,
      kind: "document",
      content: `Documento ${doc.doc_type ?? ""} revisado por asesor → ${status}${notes ? `: ${notes}` : ""}`,
      created_by: user.id,
    });
  }
  revalidatePath("/documentos");
  if (doc) revalidatePath(`/leads/${doc.lead_id}`);
}

export async function getMediaUrl(path: string) {
  const { supabase } = await auth();
  const { data } = await supabase.storage.from("media").createSignedUrl(path, 60 * 10);
  return data?.signedUrl ?? null;
}

// ---------- Configuración ----------

export async function saveAgentSettings(formData: FormData) {
  const { supabase } = await auth();
  await supabase
    .from("agent_settings")
    .update({
      enabled: formData.get("enabled") === "on",
      agent_name: str(formData, "agent_name") ?? "Asistente",
      system_prompt: String(formData.get("system_prompt") ?? ""),
      effort: str(formData, "effort") ?? "low",
      reply_delay_seconds: Number(formData.get("reply_delay_seconds") ?? 6),
      history_limit: Number(formData.get("history_limit") ?? 40),
    })
    .eq("id", 1);
  revalidatePath("/configuracion");
}

export async function configureGreenWebhook(appUrl: string) {
  await auth();
  try {
    const url = `${appUrl.replace(/\/$/, "")}/api/webhooks/green-api`;
    await setWebhook(url, process.env.GREEN_API_WEBHOOK_TOKEN);
    return { ok: true, url };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function checkGreenApi() {
  await auth();
  if (!isGreenApiConfigured()) return { state: "no_configurado" };
  try {
    const { stateInstance } = await getStateInstance();
    return { state: stateInstance };
  } catch (e) {
    return { state: "error", error: (e as Error).message };
  }
}
