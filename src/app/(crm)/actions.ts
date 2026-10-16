"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStateInstance, isGreenApiConfigured, sendFileByUrl, sendText, setWebhook } from "@/lib/whatsapp/green-api";
import { getContractData, missingContractFields, renderDesempleoContract } from "@/lib/contracts";
import { advisorMessage, buildExpedienteZip } from "@/lib/expediente";
import { replyToLead } from "@/lib/ai/agent";
import { leadStatusMeta } from "@/lib/constants";
import { addProductToLead } from "@/lib/products";
import { applyBanxicoCheck, banxicoLineForAgent, BANXICO_LABEL, checkReceiptWithBanxico } from "@/lib/payment-verification";
import { isMinorIssue } from "@/lib/payments";
import { chatIdFromPhone, digits, formatPhone, normalizeMxPhone } from "@/lib/utils";
import type { DocumentRow, DocumentStatus, Lead, LeadStatus, Profile, Tramite, TramiteStatus } from "@/lib/types";

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
      source: "manual",
      assigned_to: user.id,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message.includes("duplicate") ? "Ya existe un prospecto con ese teléfono" : error.message);
  await supabase.from("activities").insert({ lead_id: data.id, kind: "system", content: "Prospecto creado manualmente", created_by: user.id });
  for (const product of formData.getAll("products")) {
    if (typeof product === "string" && product) await addProductToLead(supabase, data.id, product, "interesado", { createdBy: user.id });
  }
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
  const { data: lead } = await supabase.from("leads").select("wa_chat_id, ai_enabled").eq("id", leadId).single();
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
    // Si escribe un asesor, la IA se pausa para no cruzar respuestas (se reactiva con el switch "IA")
    await supabase
      .from("leads")
      .update({ last_message_at: new Date().toISOString(), unread_count: 0, ...(lead.ai_enabled ? { ai_enabled: false } : {}) })
      .eq("id", leadId);
    if (lead.ai_enabled) {
      await supabase.from("activities").insert({ lead_id: leadId, kind: "ai", content: "Asistente IA pausado: respondió un asesor", created_by: user.id });
      revalidatePath("/", "layout");
    }
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
  const status = (str(formData, "status") ?? "pendiente") as TramiteStatus;
  const r = await addProductToLead(supabase, leadId, tipo, status === "interesado" ? "interesado" : "pendiente", {
    notes: str(formData, "notes"),
    createdBy: user.id,
  });
  if (!r.tramite) return;
  // Estados más avanzados (en proceso, en espera IMSS…) se aplican tal cual
  const extra = {
    ...(status !== "interesado" && status !== "pendiente" ? { status } : {}),
    ...(str(formData, "folio_imss") ? { folio_imss: str(formData, "folio_imss") } : {}),
    ...(str(formData, "due_date") ? { due_date: str(formData, "due_date") } : {}),
  };
  if (Object.keys(extra).length) await supabase.from("tramites").update(extra).eq("id", r.tramite.id);
  await supabase.from("activities").insert({
    lead_id: leadId,
    kind: "tramite",
    content: r.result === "creado" ? `Producto agregado: ${tipo}` : `Producto actualizado: ${tipo}`,
    created_by: user.id,
  });
  await syncLeadStatusFromTramites(supabase, leadId);
  revalidatePath(`/leads/${leadId}`);
}

/**
 * El estado general del prospecto sigue a sus trámites:
 * - alguno con asesor o en espera del IMSS → "En trámite"
 * - ninguno abierto y al menos uno resuelto → "Completado"
 * Nunca lo regresa ni toca a los descartados.
 */
async function syncLeadStatusFromTramites(supabase: Awaited<ReturnType<typeof createClient>>, leadId: string) {
  const [{ data: lead }, { data: rows }] = await Promise.all([
    supabase.from("leads").select("status").eq("id", leadId).single(),
    supabase.from("tramites").select("status").eq("lead_id", leadId),
  ]);
  if (!lead || lead.status === "descartado" || lead.status === "completado") return;
  const statuses = ((rows ?? []) as { status: TramiteStatus }[]).map((r) => r.status);
  const open = statuses.filter((s) => !["resuelto", "rechazado", "cancelado"].includes(s));
  let next: LeadStatus | null = null;
  if (open.some((s) => s === "en_proceso" || s === "en_espera_imss")) {
    if (["nuevo", "en_conversacion", "registro_completo", "documentos_pendientes", "en_revision"].includes(lead.status)) next = "en_tramite";
  } else if (!open.length && statuses.includes("resuelto")) {
    next = "completado";
  }
  if (!next || next === lead.status) return;
  await supabase.from("leads").update({ status: next }).eq("id", leadId);
  await supabase.from("activities").insert({
    lead_id: leadId,
    kind: "status_change",
    content: `Estado general: ${leadStatusMeta(lead.status).label} → ${leadStatusMeta(next).label} (por sus trámites)`,
  });
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
  await syncLeadStatusFromTramites(supabase, leadId);
  revalidatePath(`/leads/${leadId}`);
}

/** Cambia el asesor de un trámite. Vacío = usar el asesor principal del prospecto. */
export async function setTramiteAdvisor(tramiteId: string, leadId: string, advisorId: string | null): Promise<{ error?: string }> {
  const { supabase, user } = await auth();
  const { error } = await supabase.from("tramites").update({ assigned_to: advisorId }).eq("id", tramiteId);
  if (error) {
    return { error: error.message.includes("assigned_to") ? "Falta correr la migración 0006_asesor_por_tramite.sql en Supabase" : error.message };
  }
  const [{ data: advisor }, { data: t }] = await Promise.all([
    advisorId ? supabase.from("profiles").select("full_name, email").eq("id", advisorId).single() : Promise.resolve({ data: null }),
    supabase.from("tramites").select("tipo").eq("id", tramiteId).single(),
  ]);
  await supabase.from("activities").insert({
    lead_id: leadId,
    kind: "tramite",
    content: `Asesor de ${t?.tipo ?? "trámite"}: ${advisor ? (advisor.full_name ?? advisor.email) : "el principal del prospecto"}`,
    created_by: user.id,
  });
  revalidatePath(`/leads/${leadId}`);
  return {};
}

// ---------- Documentos ----------

export async function reviewDocument(documentId: string, status: DocumentStatus, notes?: string): Promise<{ error?: string }> {
  const { supabase, user } = await auth();
  const patch = { status, review_notes: notes ?? null, reviewed_by: user.id as string | null, reviewed_at: new Date().toISOString() };
  const update = () => supabase.from("documents").update(patch).eq("id", documentId).select("lead_id, doc_type").single();
  let { data: doc, error } = await update();
  // Usuario sin fila en "profiles": se guarda la revisión sin quién la hizo en lugar de fallar
  if (error?.code === "23503") {
    patch.reviewed_by = null;
    ({ data: doc, error } = await update());
  }
  if (error || !doc) {
    console.error("reviewDocument", documentId, error);
    return { error: error?.message ?? "No se pudo actualizar el documento" };
  }
  await supabase.from("activities").insert({
    lead_id: doc.lead_id,
    kind: "document",
    content: `Documento ${doc.doc_type ?? ""} revisado por asesor → ${status}${notes ? `: ${notes}` : ""}`,
    created_by: patch.reviewed_by,
  });
  revalidatePath("/documentos");
  revalidatePath(`/leads/${doc.lead_id}`);
  return {};
}

/** Vuelve a consultar el CEP de Banxico para un comprobante (p. ej. si al recibirlo aún no aparecía). */
export async function recheckPaymentWithBanxico(documentId: string): Promise<{ error?: string; estado?: string; detalle?: string }> {
  const { supabase, user } = await auth();
  const { data: doc } = await supabase.from("documents").select("*").eq("id", documentId).single<DocumentRow>();
  if (!doc || doc.doc_type !== "comprobante_pago") return { error: "Este documento no es un comprobante de pago" };
  const { data: lead } = await supabase.from("leads").select("*").eq("id", doc.lead_id).single<Lead>();
  if (!lead) return { error: "Prospecto no encontrado" };

  const ex = doc.extracted as { pago?: Parameters<typeof checkReceiptWithBanxico>[0]; summary?: string };
  const bx = await checkReceiptWithBanxico(ex.pago ?? null, Number(lead.captured_data?.pago_monto_esperado) || undefined);

  // Observaciones del OCR sin las de la consulta anterior a Banxico
  const labels = Object.values(BANXICO_LABEL);
  const base = doc.issues.filter((i) => !labels.some((l) => i.startsWith(l)) && !i.startsWith("Observación menor: no se pudo verificar en Banxico"));
  const isDuplicate = base.some((i) => i.startsWith("Este comprobante ya se había recibido"));
  const baseStatus: DocumentStatus = doc.status === "invalido" ? "invalido" : base.some((i) => !isMinorIssue(i)) ? "con_observaciones" : "valido";
  const { status, issues } = applyBanxicoCheck(baseStatus, base, bx, isDuplicate);
  const summary = [...(ex.summary ?? "").split("\n").filter((l) => !l.startsWith("VERIFICACIÓN BANXICO")), banxicoLineForAgent(bx)].join("\n");

  await supabase.from("documents").update({ status, issues, extracted: { ...doc.extracted, banxico: bx, summary } }).eq("id", doc.id);
  const captured: Record<string, unknown> = { ...lead.captured_data, pago_banxico: bx.estado, pago_banxico_detalle: bx.detalle };
  if (status === "valido") captured.pago_estado = "comprobante_valido";
  await supabase.from("leads").update({ captured_data: captured }).eq("id", lead.id);
  await supabase.from("activities").insert({
    lead_id: lead.id,
    kind: "document",
    content: `${BANXICO_LABEL[bx.estado]} (consulta manual): ${bx.detalle}`,
    meta: { banxico: bx },
    created_by: user.id,
  });
  revalidatePath(`/leads/${lead.id}`);
  revalidatePath("/documentos");
  return { estado: BANXICO_LABEL[bx.estado], detalle: bx.detalle };
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

// ---------- Catálogo de productos ----------

export async function createProduct(formData: FormData) {
  const { supabase } = await auth();
  const name = str(formData, "name");
  if (!name) return { error: "Escribe el nombre del producto" };
  const { data: last } = await supabase.from("products").select("sort_order").order("sort_order", { ascending: false }).limit(1);
  const { error } = await supabase.from("products").insert({
    name,
    description: str(formData, "description") ?? "",
    offered_by_ai: formData.get("offered_by_ai") === "on",
    sort_order: (last?.[0]?.sort_order ?? 0) + 10,
  });
  if (error) return { error: error.code === "23505" ? "Ya existe un producto con ese nombre" : error.message };
  revalidatePath("/productos");
  return { ok: true };
}

export async function updateProduct(productId: string, formData: FormData) {
  const { supabase } = await auth();
  await supabase
    .from("products")
    .update({
      description: str(formData, "description") ?? "",
      offered_by_ai: formData.get("offered_by_ai") === "on",
      active: formData.get("active") === "on",
      sort_order: Number(formData.get("sort_order") ?? 0) || 0,
    })
    .eq("id", productId);
  revalidatePath("/productos");
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
  if (!fullName) return { error: "El nombre es obligatorio" };
  if (!phoneRaw || digits(phoneRaw).length < 10) return { error: "El WhatsApp es obligatorio (10 dígitos)" };
  if (email && (!password || password.length < 8)) return { error: "Con correo, la contraseña debe tener al menos 8 caracteres" };
  const phone = normalizeMxPhone(phoneRaw);

  // Sin correo el asesor no entra al CRM: solo recibe contratos y expedientes por WhatsApp.
  // Supabase Auth exige correo, así que se usa uno interno que nunca se muestra, con contraseña aleatoria.
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: email ?? `asesor-${phone}-${Date.now()}@sin-correo.invalid`,
    password: email ? password! : `${crypto.randomUUID()}${crypto.randomUUID()}`,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data.user) return { error: error?.message ?? "No se pudo crear el usuario" };
  // El trigger handle_new_user crea el perfil; se asegura nombre, rol y WhatsApp
  const { error: upErr } = await admin
    .from("profiles")
    .upsert({ id: data.user.id, email: email ?? null, full_name: fullName, role: "asesor", phone, city, state });
  revalidatePath("/asesores");
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
  revalidatePath("/asesores");
}

// ---------- Contrato de retiro por desempleo ----------

/** Genera el contrato con los datos del CRM y lo envía en PDF al WhatsApp del asesor asignado. */
export async function sendDesempleoContract(leadId: string): Promise<{ error?: string; missing?: string[]; url?: string; sentTo?: string }> {
  const { supabase, user } = await auth();
  const { data: lead } = await supabase.from("leads").select("*").eq("id", leadId).single();
  if (!lead) return { error: "Prospecto no encontrado" };

  const { data: desempleo } = await supabase
    .from("tramites")
    .select("*")
    .eq("lead_id", leadId)
    .ilike("tipo", "retiro por desempleo")
    .not("status", "in", "(rechazado,cancelado)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<Tramite>();
  const data = await getContractData(supabase, lead as Lead, desempleo?.assigned_to);
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

// ---------- Expediente al asesor ----------

/**
 * Manda al WhatsApp del asesor asignado el resumen del trámite y un ZIP con los documentos
 * y datos del prospecto. Si el trámite seguía en "Registrado", pasa a "En proceso".
 */
export async function sendExpedienteToAdvisor(tramiteId: string): Promise<{ error?: string; sentTo?: string; url?: string; docCount?: number; failed?: string[] }> {
  const { supabase, user } = await auth();
  const { data: tramite } = await supabase.from("tramites").select("*").eq("id", tramiteId).single<Tramite>();
  if (!tramite) return { error: "Trámite no encontrado" };
  const { data: lead } = await supabase.from("leads").select("*").eq("id", tramite.lead_id).single<Lead>();
  if (!lead) return { error: "Prospecto no encontrado" };
  const advisorId = tramite.assigned_to ?? lead.assigned_to;
  if (!advisorId) return { error: "Este trámite no tiene asesor. Elígelo arriba del botón." };
  const { data: advisor } = await supabase.from("profiles").select("id, full_name, phone").eq("id", advisorId).single<Pick<Profile, "id" | "full_name" | "phone">>();
  if (!advisor?.phone) return { error: "El asesor asignado no tiene WhatsApp registrado. Agrégalo en el menú Asesores." };
  if (!isGreenApiConfigured()) return { error: "Green API no está configurado" };

  const { zip, docCount, failed } = await buildExpedienteZip(supabase, lead, tramite);
  const slug = tramite.tipo.normalize("NFD").replace(/[^\w]+/g, "-").toLowerCase();
  const path = `${lead.id}/expediente-${slug}-${Date.now()}.zip`;
  const { error: upErr } = await supabase.storage.from("media").upload(path, zip, { contentType: "application/zip" });
  if (upErr) return { error: `No se pudo guardar el ZIP: ${upErr.message}` };
  const { data: signed } = await supabase.storage.from("media").createSignedUrl(path, 60 * 60 * 24 * 7);
  if (!signed) return { error: "No se pudo generar el enlace del ZIP" };

  const chatId = chatIdFromPhone(advisor.phone);
  const fileName = `Expediente ${tramite.tipo} - ${lead.full_name ?? lead.wa_name ?? lead.folio} (${lead.folio}).zip`.replace(/[\\/:*?"<>|]+/g, " ");
  try {
    await sendText(chatId, advisorMessage(lead, tramite, advisor, docCount));
    await sendFileByUrl(chatId, signed.signedUrl, fileName);
  } catch (e) {
    return { error: `Expediente generado, pero no se pudo enviar por WhatsApp: ${(e as Error).message}`, url: signed.signedUrl };
  }

  if (tramite.status === "interesado" || tramite.status === "pendiente") {
    await supabase.from("tramites").update({ status: "en_proceso" }).eq("id", tramite.id);
    await syncLeadStatusFromTramites(supabase, lead.id);
  }
  await supabase.from("activities").insert({
    lead_id: lead.id,
    kind: "tramite",
    content: `Expediente de ${tramite.tipo} enviado por WhatsApp al asesor ${advisor.full_name ?? ""} (${docCount} documentos)`,
    meta: { path, tramite_id: tramite.id, advisor_id: advisor.id },
    created_by: user.id,
  });
  revalidatePath(`/leads/${lead.id}`);
  revalidatePath("/leads");
  return { sentTo: advisor.full_name ?? formatPhone(advisor.phone), url: signed.signedUrl, docCount, failed };
}
