"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStateInstance, isGreenApiConfigured, sendFileByUrl, sendText, setWebhook } from "@/lib/whatsapp/green-api";
import { getContractData, missingContractFields, renderDesempleoContract } from "@/lib/contracts";
import { replyToLead } from "@/lib/ai/agent";
import { leadStatusMeta } from "@/lib/constants";
import { chatIdFromPhone, normalizeMxPhone } from "@/lib/utils";
import type { DocumentStatus, Lead, LeadStatus, TramiteStatus } from "@/lib/types";

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
  // Campos del contrato de retiro por desempleo (se guardan en captured_data)
  const contractKeys = ["afore", "domicilio", "clave_elector"] as const;
  const contractFields = contractKeys.filter((k) => formData.has(k));
  let captured: Record<string, unknown> | undefined;
  if (contractFields.length) {
    const { data: current } = await supabase.from("leads").select("captured_data").eq("id", leadId).single();
    const next: Record<string, unknown> = { ...(current?.captured_data ?? {}) };
    for (const k of contractFields) {
      const v = str(formData, k);
      if (v) next[k] = k === "clave_elector" ? v.toUpperCase() : v;
      else delete next[k];
    }
    captured = next;
  }
  await supabase.from("leads").update(captured ? { ...update, captured_data: captured } : update).eq("id", leadId);
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

// ---------- Equipo (asesores) ----------

export async function createAdvisor(formData: FormData) {
  await auth();
  const email = str(formData, "email");
  const password = str(formData, "password");
  const fullName = str(formData, "full_name");
  const phoneRaw = str(formData, "phone");
  const city = str(formData, "city");
  const state = str(formData, "state");
  if (!email || !password || !fullName) return { error: "Nombre, correo y contraseña son obligatorios" };
  if (password.length < 8) return { error: "La contraseña debe tener al menos 8 caracteres" };

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data.user) return { error: error?.message ?? "No se pudo crear el usuario" };
  // El trigger handle_new_user crea el perfil; se asegura nombre, rol y WhatsApp
  const { error: upErr } = await admin
    .from("profiles")
    .upsert({ id: data.user.id, email, full_name: fullName, role: "asesor", phone: phoneRaw ? normalizeMxPhone(phoneRaw) : null, city, state });
  revalidatePath("/configuracion");
  if (upErr) return { error: `Usuario creado, pero no se guardaron su WhatsApp, ciudad y estado: ${upErr.message}` };
  return { ok: true };
}

export async function updateAdvisor(profileId: string, formData: FormData) {
  const { supabase } = await auth();
  const phoneRaw = str(formData, "phone");
  await supabase
    .from("profiles")
    .update({
      full_name: str(formData, "full_name"),
      phone: phoneRaw ? normalizeMxPhone(phoneRaw) : null,
      city: str(formData, "city"),
      state: str(formData, "state"),
    })
    .eq("id", profileId);
  revalidatePath("/configuracion");
}

// ---------- Contrato de retiro por desempleo ----------

/** Genera el contrato con los datos del CRM y lo envía en PDF al WhatsApp del asesor asignado. */
export async function sendDesempleoContract(leadId: string): Promise<{ error?: string; missing?: string[]; url?: string; sentTo?: string }> {
  const { supabase, user } = await auth();
  const { data: lead } = await supabase.from("leads").select("*").eq("id", leadId).single();
  if (!lead) return { error: "Prospecto no encontrado" };

  const data = await getContractData(supabase, lead as Lead);
  const missing = missingContractFields(data);
  if (missing.length) return { missing };
  if (!isGreenApiConfigured()) return { error: "Green API no está configurado" };

  const pdf = await renderDesempleoContract(data);
  const path = `${leadId}/contrato-desempleo-${Date.now()}.pdf`;
  const { error: upErr } = await supabase.storage.from("media").upload(path, pdf, { contentType: "application/pdf" });
  if (upErr) return { error: `No se pudo guardar el contrato: ${upErr.message}` };
  const { data: signed } = await supabase.storage.from("media").createSignedUrl(path, 60 * 60 * 24 * 7);
  if (!signed) return { error: "No se pudo generar el enlace del contrato" };

  const fileName = `Contrato retiro desempleo - ${data.beneficiario} (${lead.folio}).pdf`;
  try {
    await sendFileByUrl(chatIdFromPhone(data.asesorPhone!), signed.signedUrl, fileName, `Contrato de retiro por desempleo · ${data.beneficiario} · ${lead.folio}`);
  } catch (e) {
    return { error: `Contrato generado, pero no se pudo enviar por WhatsApp: ${(e as Error).message}`, url: signed.signedUrl };
  }
  await supabase.from("activities").insert({
    lead_id: leadId,
    kind: "document",
    content: `Contrato de retiro por desempleo enviado por WhatsApp al asesor ${data.profesionista}`,
    meta: { path },
    created_by: user.id,
  });
  revalidatePath(`/leads/${leadId}`);
  return { url: signed.signedUrl, sentTo: data.profesionista! };
}
