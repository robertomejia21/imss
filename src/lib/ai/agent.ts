import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { anthropic, FALLBACK_BETA, MODEL } from "./anthropic";
import { DEFAULT_AGENT_PROMPT, OPERATIONAL_CONTEXT } from "./prompt";
import { createAdminClient } from "@/lib/supabase/admin";
import { keepTyping, sendFileByUrl, sendText } from "@/lib/whatsapp/green-api";
import { ALTA_PRICES, PAYMENT, buildSlip, cdmxDate, formatMxn, isPaymentConfigFictitious, renderPaymentSlipPdf } from "@/lib/payments";
import { isValidCurp, isValidNss } from "@/lib/utils";
import { TRAMITE_TYPES } from "@/lib/constants";
import type { AgentSettings, DocumentRow, Lead, LeadStatus, Message, Tramite } from "@/lib/types";

type Db = ReturnType<typeof createAdminClient>;

const MAX_TOOL_ROUNDS = 6;
const LOCK_SECONDS = 120;
const SLIP_URL_SECONDS = 7 * 24 * 3600; // el enlace del PDF debe durar lo suficiente para que Green API lo descargue

// =============================================================
// Herramientas del agente
// =============================================================

const SaveLeadInput = z.object({
  full_name: z.string().optional(),
  curp: z.string().optional(),
  nss: z.string().optional(),
  rfc: z.string().optional(),
  email: z.string().optional(),
  birth_date: z.string().optional(),
  tramite_type: z.string().optional(),
  extra: z.record(z.string(), z.string()).optional(),
});

const SetStatusInput = z.object({
  status: z.enum(["en_conversacion", "registro_completo", "documentos_pendientes"]),
  reason: z.string(),
});

const HumanInput = z.object({ reason: z.string() });
const SlipInput = z.object({
  plan: z.enum(["medico", "pension"]),
  infonavit: z.boolean().optional(),
  afore: z.boolean().optional(),
});

const tools: Anthropic.Beta.BetaTool[] = [
  {
    name: "guardar_datos_lead",
    description:
      "Guarda o corrige datos del prospecto en el CRM en cuanto los proporcione. Envía solo los campos que conozcas. Devuelve advertencias si la CURP o el NSS no son válidos para que se los pidas de nuevo.",
    input_schema: {
      type: "object",
      properties: {
        full_name: { type: "string", description: "Nombre completo como aparece en su identificación" },
        curp: { type: "string", description: "CURP de 18 caracteres" },
        nss: { type: "string", description: "Número de Seguridad Social de 11 dígitos" },
        rfc: { type: "string" },
        email: { type: "string" },
        birth_date: { type: "string", description: "Fecha de nacimiento YYYY-MM-DD" },
        tramite_type: { type: "string", description: `Trámite que necesita. Opciones habituales: ${TRAMITE_TYPES.join(", ")}` },
        extra: {
          type: "object",
          description: "Otros datos relevantes (clave: valor), por ejemplo semanas cotizadas, último patrón, ciudad",
          additionalProperties: { type: "string" },
        },
      },
    },
  },
  {
    name: "actualizar_estado",
    description:
      "Mueve al prospecto en el embudo del CRM. Usa 'registro_completo' cuando ya tengas nombre, CURP y tipo de trámite; 'documentos_pendientes' cuando falten documentos por enviar.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["en_conversacion", "registro_completo", "documentos_pendientes"] },
        reason: { type: "string", description: "Motivo breve, visible para los asesores" },
      },
      required: ["status", "reason"],
    },
  },
  {
    name: "solicitar_asesor_humano",
    description:
      "Transfiere la conversación a un asesor humano y pausa al asistente para este contacto. Úsala si la persona lo pide, está molesta, o el caso requiere criterio humano. Después despídete diciendo que un asesor le escribirá pronto.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string", description: "Motivo para el asesor" } },
      required: ["reason"],
    },
  },
  {
    name: "generar_ficha_pago",
    description:
      "Genera la ficha de pago en PDF del Alta en IMSS según el paquete que eligió el prospecto y la envía por WhatsApp. " +
      `Precios: plan "medico" ${formatMxn(ALTA_PRICES.medico)}; plan "pension" ${formatMxn(ALTA_PRICES.pension)}, ` +
      `+ Infonavit ${formatMxn(ALTA_PRICES.infonavit)} y/o + AFORE ${formatMxn(ALTA_PRICES.afore)} (extras solo con el plan "pension"). ` +
      "Úsala solo cuando ya confirmó sus datos (nombre completo y CURP), eligió su paquete y aceptó recibir la ficha. Después de usarla, en tu respuesta solo explica brevemente cómo pagar y que te envíe el comprobante; no repitas toda la ficha.",
    input_schema: {
      type: "object",
      properties: {
        plan: {
          type: "string",
          enum: ["medico", "pension"],
          description: '"medico" = solo servicio médico; "pension" = servicio médico y semanas de pensión (RSV)',
        },
        infonavit: { type: "boolean", description: 'Agregar Infonavit (solo con plan "pension")' },
        afore: { type: "boolean", description: 'Agregar AFORE (solo con plan "pension")' },
      },
      required: ["plan"],
    },
  },
  {
    name: "consultar_expediente",
    description:
      "Consulta los trámites registrados del prospecto, su estado, y los documentos recibidos con su resultado de verificación.",
    input_schema: { type: "object", properties: {} },
  },
];

async function executeTool(db: Db, lead: Lead, name: string, input: unknown): Promise<string> {
  switch (name) {
    case "guardar_datos_lead": {
      const parsed = SaveLeadInput.safeParse(input);
      if (!parsed.success) return `Error: datos inválidos (${parsed.error.message})`;
      const { extra, ...fields } = parsed.data;
      const warnings: string[] = [];
      const update: Partial<Lead> = {};

      for (const [k, v] of Object.entries(fields)) {
        if (v && v.trim()) (update as Record<string, string>)[k] = v.trim();
      }
      if (update.curp) {
        update.curp = update.curp.toUpperCase().replace(/\s/g, "");
        if (!isValidCurp(update.curp)) warnings.push(`La CURP ${update.curp} no es válida; pídela de nuevo.`);
      }
      if (update.nss) {
        update.nss = update.nss.replace(/\D/g, "");
        if (!isValidNss(update.nss)) warnings.push(`El NSS ${update.nss} no es válido; pídelo de nuevo.`);
      }
      if (update.birth_date && !/^\d{4}-\d{2}-\d{2}$/.test(update.birth_date)) {
        warnings.push("La fecha de nacimiento debe ir en formato YYYY-MM-DD; no se guardó.");
        delete update.birth_date;
      }
      if (extra) update.captured_data = { ...lead.captured_data, ...extra };

      if (Object.keys(update).length > 0) {
        const { error } = await db.from("leads").update(update).eq("id", lead.id);
        if (error) return `Error al guardar: ${error.message}`;
        Object.assign(lead, update);
        await db.from("activities").insert({
          lead_id: lead.id,
          kind: "ai",
          content: `IA guardó: ${Object.keys(update).join(", ")}`,
          meta: update,
        });
      }
      return warnings.length ? `Guardado con advertencias: ${warnings.join(" ")}` : "Datos guardados correctamente.";
    }

    case "actualizar_estado": {
      const parsed = SetStatusInput.safeParse(input);
      if (!parsed.success) return `Error: ${parsed.error.message}`;
      // La IA no regresa a un lead que ya está más avanzado en el embudo
      const advanced: LeadStatus[] = ["en_revision", "en_tramite", "completado", "descartado"];
      if (advanced.includes(lead.status)) return `El expediente ya está en estado "${lead.status}"; no se modificó.`;
      await db.from("leads").update({ status: parsed.data.status }).eq("id", lead.id);
      await db.from("activities").insert({
        lead_id: lead.id,
        kind: "status_change",
        content: `IA cambió estado: ${lead.status} → ${parsed.data.status}. ${parsed.data.reason}`,
      });
      lead.status = parsed.data.status;
      return `Estado actualizado a ${parsed.data.status}.`;
    }

    case "solicitar_asesor_humano": {
      const parsed = HumanInput.safeParse(input);
      const reason = parsed.success ? parsed.data.reason : "Solicitud de asesor";
      await db
        .from("leads")
        .update({ needs_human: true, needs_human_reason: reason, ai_enabled: false })
        .eq("id", lead.id);
      lead.needs_human = true;
      lead.ai_enabled = false; // marca local: el traspaso ocurrió en esta misma respuesta
      await db.from("activities").insert({ lead_id: lead.id, kind: "ai", content: `IA solicitó asesor humano: ${reason}` });
      return "Listo: se notificó a un asesor y el asistente queda en pausa para este contacto. Despídete amablemente.";
    }

    case "generar_ficha_pago": {
      if (!lead.full_name || !lead.curp) {
        return "No se generó la ficha: faltan el nombre completo o la CURP. Pídelos y guárdalos primero.";
      }
      if (!lead.wa_chat_id) return "No se generó la ficha: el prospecto no tiene chat de WhatsApp vinculado.";
      if (lead.captured_data?.pago_estado === "comprobante_valido") {
        return "No se generó la ficha: este prospecto ya tiene un comprobante de pago válido.";
      }

      const parsed = SlipInput.safeParse(input);
      if (!parsed.success) return `No se generó la ficha: paquete inválido (${parsed.error.message}).`;
      const pkg = { plan: parsed.data.plan, infonavit: !!parsed.data.infonavit, afore: !!parsed.data.afore };
      if (pkg.plan === "medico" && (pkg.infonavit || pkg.afore)) {
        return 'No se generó la ficha: Infonavit y AFORE solo se pueden agregar al plan "pension" (2,600). Confirma con el prospecto qué paquete quiere.';
      }

      const slip = buildSlip(lead, pkg);
      const pdf = await renderPaymentSlipPdf(lead, slip);
      const fileName = `Ficha-de-pago-${lead.folio}.pdf`;
      const path = `${lead.id}/ficha-pago-${slip.issuedAt.getTime()}.pdf`;
      const { error: upErr } = await db.storage.from("media").upload(path, pdf, { contentType: "application/pdf", upsert: true });
      if (upErr) return `Error al guardar la ficha: ${upErr.message}`;
      const { data: signed, error: signErr } = await db.storage.from("media").createSignedUrl(path, SLIP_URL_SECONDS);
      if (signErr || !signed) return `Error al generar el enlace de la ficha: ${signErr?.message ?? "sin URL"}`;

      const idMessage = await sendFileByUrl(lead.wa_chat_id, signed.signedUrl, fileName);
      await db.from("messages").insert({
        lead_id: lead.id,
        direction: "out",
        sender: "ai",
        type: "document",
        body: `Ficha de pago ${lead.folio} (${formatMxn(slip.amount)})`,
        media_path: path,
        media_mime: "application/pdf",
        wa_message_id: idMessage,
        status: "sent",
        meta: { fileName, kind: "ficha_pago" },
      });

      const pago = {
        pago_estado: "ficha_enviada",
        pago_ficha_fecha: cdmxDate(slip.issuedAt),
        pago_ficha_vence: slip.expiresAt.toISOString(),
        pago_monto_esperado: String(slip.amount),
        pago_paquete: slip.concept,
        pago_referencia: slip.reference,
      };
      const captured = { ...lead.captured_data, ...pago };
      await db.from("leads").update({ captured_data: captured }).eq("id", lead.id);
      lead.captured_data = captured;
      await db.from("activities").insert({
        lead_id: lead.id,
        kind: "ai",
        content: `IA envió ficha de pago ${slip.reference} por ${formatMxn(slip.amount)}${isPaymentConfigFictitious() ? " (cuenta FICTICIA de prueba)" : ""}`,
        meta: pago,
      });
      return [
        "Ficha de pago enviada por WhatsApp como PDF.",
        `Paquete: ${slip.concept}. Monto: ${formatMxn(slip.amount)}. Referencia: ${slip.reference}. Vigencia: ${PAYMENT.validHours} horas.`,
        `Banco: ${PAYMENT.bank}. Beneficiario: ${PAYMENT.beneficiary}. CLABE: ${PAYMENT.clabe}.`,
        "pago_estado quedó como ficha_enviada.",
      ].join(" ");
    }

    case "consultar_expediente": {
      const [{ data: tramites }, { data: docs }] = await Promise.all([
        db.from("tramites").select("*").eq("lead_id", lead.id).order("created_at"),
        db.from("documents").select("doc_type,status,issues,created_at").eq("lead_id", lead.id).order("created_at"),
      ]);
      return JSON.stringify({
        estado_expediente: lead.status,
        tramites: (tramites as Tramite[] | null)?.map((t) => ({
          tipo: t.tipo,
          estado: t.status,
          folio_imss: t.folio_imss,
          fecha_compromiso: t.due_date,
          notas: t.notes,
        })),
        documentos: docs,
      });
    }

    default:
      return `Herramienta desconocida: ${name}`;
  }
}

// =============================================================
// Historial → mensajes para Claude
// =============================================================

function messageToText(m: Message, docsByMessage: Map<string, DocumentRow>): string {
  if (m.direction === "out" && m.type === "document") return `[Archivo enviado al usuario] ${m.body ?? (m.meta?.fileName as string) ?? ""}`;
  if (m.sender === "agent") return `[Asesor] ${m.body ?? ""}`;
  switch (m.type) {
    case "audio":
      return m.transcription ? `[Nota de voz] ${m.transcription}` : "[Nota de voz] (no se pudo transcribir)";
    case "image":
    case "document": {
      const doc = docsByMessage.get(m.id);
      const label = m.type === "image" ? "[Imagen recibida]" : "[Documento recibido]";
      const caption = m.body ? `\nTexto que la acompaña: ${m.body}` : "";
      const analysis = doc?.extracted?.summary ? `\n${doc.extracted.summary as string}` : "\n(sin análisis disponible)";
      return `${label}${caption}${analysis}`;
    }
    case "location":
      return `[Ubicación compartida] ${m.body ?? ""}`;
    case "video":
      return `[Video recibido] ${m.body ?? ""} (no se puede analizar video; pide una foto si es un documento)`;
    default:
      return m.body ?? "";
  }
}

async function buildConversation(db: Db, leadId: string, limit: number) {
  const { data: rows } = await db
    .from("messages")
    .select("*")
    .eq("lead_id", leadId)
    .neq("sender", "system")
    .order("created_at", { ascending: false })
    .limit(limit);
  const messages = ((rows as Message[] | null) ?? []).reverse();

  const ids = messages.filter((m) => m.type === "image" || m.type === "document").map((m) => m.id);
  const docsByMessage = new Map<string, DocumentRow>();
  if (ids.length) {
    const { data: docs } = await db.from("documents").select("*").in("message_id", ids);
    for (const d of (docs as DocumentRow[] | null) ?? []) if (d.message_id) docsByMessage.set(d.message_id, d);
  }

  // Une mensajes consecutivos del mismo rol (WhatsApp suele mandar varios seguidos)
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of messages) {
    const role = m.direction === "in" ? "user" : "assistant";
    const text = messageToText(m, docsByMessage).trim();
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content = `${last.content as string}\n\n${text}`;
    else out.push({ role, content: text });
  }
  while (out.length && out[0]!.role !== "user") out.shift();
  return { conversation: out, lastMessage: messages[messages.length - 1] };
}

function leadContext(lead: Lead) {
  const known = {
    folio: lead.folio,
    nombre_whatsapp: lead.wa_name,
    nombre_completo: lead.full_name,
    curp: lead.curp,
    nss: lead.nss,
    rfc: lead.rfc,
    email: lead.email,
    fecha_nacimiento: lead.birth_date,
    tramite: lead.tramite_type,
    estado_en_crm: lead.status,
    origen: lead.source,
    datos_formulario: Object.keys(lead.form_data ?? {}).length ? lead.form_data : undefined,
    otros_datos: Object.keys(lead.captured_data ?? {}).length ? lead.captured_data : undefined,
  };
  const now = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "full", timeStyle: "short" });
  return `Fecha y hora actual (CDMX): ${now}\n\nDatos que ya tenemos de este contacto (null = falta):\n${JSON.stringify(known, null, 2)}`;
}

// =============================================================
// Generar respuesta
// =============================================================

export async function generateReply(db: Db, lead: Lead, settings: AgentSettings): Promise<string | null> {
  const { conversation, lastMessage } = await buildConversation(db, lead.id, settings.history_limit);
  // Solo respondemos si el último mensaje es del usuario
  if (!lastMessage || lastMessage.direction !== "in" || conversation.length === 0) return null;

  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    {
      type: "text",
      text: `${settings.system_prompt?.trim() || DEFAULT_AGENT_PROMPT}\n\nTu nombre es ${settings.agent_name}.\n\n${OPERATIONAL_CONTEXT}`,
      cache_control: { type: "ephemeral" }, // instrucciones + herramientas quedan en caché
    },
    { type: "text", text: leadContext(lead) },
  ];

  const messages = [...conversation];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: settings.effort },
      system,
      tools,
      messages,
    });

    if (response.stop_reason === "refusal") {
      await db
        .from("leads")
        .update({ needs_human: true, needs_human_reason: "La IA no pudo responder este mensaje" })
        .eq("id", lead.id);
      return null;
    }

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");

    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return text || null;
    }

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = await Promise.all(
      toolUses.map(async (t) => {
        try {
          return { type: "tool_result" as const, tool_use_id: t.id, content: await executeTool(db, lead, t.name, t.input) };
        } catch (e) {
          return { type: "tool_result" as const, tool_use_id: t.id, content: `Error: ${(e as Error).message}`, is_error: true };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }
  return null;
}

// =============================================================
// Orquestación: candado, envío por WhatsApp y re-chequeo
// =============================================================

async function acquireLock(db: Db, leadId: string) {
  const now = new Date();
  const until = new Date(now.getTime() + LOCK_SECONDS * 1000).toISOString();
  const { data } = await db
    .from("leads")
    .update({ ai_locked_until: until })
    .eq("id", leadId)
    .or(`ai_locked_until.is.null,ai_locked_until.lt.${now.toISOString()}`)
    .select("id");
  return (data?.length ?? 0) > 0;
}

const releaseLock = (db: Db, leadId: string) => db.from("leads").update({ ai_locked_until: null }).eq("id", leadId);

/** ¿Hay audios o documentos de este lead que aún se están procesando? */
async function hasPendingMedia(db: Db, leadId: string) {
  const since = new Date(Date.now() - 5 * 60_000).toISOString();
  const { count } = await db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", leadId)
    .eq("direction", "in")
    .gte("created_at", since)
    .contains("meta", { processing: true });
  return (count ?? 0) > 0;
}

export async function getAgentSettings(db: Db): Promise<AgentSettings> {
  const { data } = await db.from("agent_settings").select("*").eq("id", 1).single();
  return data as AgentSettings;
}

/**
 * Punto de entrada: decide si el agente debe responder a este lead y, si sí, responde.
 * Seguro de llamar varias veces: usa un candado en la fila del lead.
 */
export async function replyToLead(leadId: string) {
  const db = createAdminClient();

  for (let attempt = 0; attempt < 3; attempt++) {
    const settings = await getAgentSettings(db);
    const { data: lead } = await db.from("leads").select("*").eq("id", leadId).single<Lead>();
    if (!settings?.enabled || !lead?.ai_enabled || !lead.wa_chat_id) return;
    if (await hasPendingMedia(db, leadId)) return; // el procesador de media nos volverá a llamar

    if (!(await acquireLock(db, leadId))) return;
    let answeredUpTo: string | undefined;
    try {
      const { data: lastIn } = await db
        .from("messages")
        .select("created_at")
        .eq("lead_id", leadId)
        .eq("direction", "in")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      answeredUpTo = lastIn?.created_at;

      // Mostrar "escribiendo…" en WhatsApp mientras la IA prepara la respuesta
      const stopTyping = keepTyping(lead.wa_chat_id);
      let reply: string | null;
      try {
        reply = await generateReply(db, lead, settings);
      } finally {
        stopTyping();
      }
      if (!reply) return;

      // Si mientras pensaba un asesor desactivó la IA o respondió, no enviamos
      // (salvo que la propia IA haya hecho el traspaso y se esté despidiendo)
      const { data: fresh } = await db.from("leads").select("ai_enabled").eq("id", leadId).single();
      const { data: lastMsg } = await db
        .from("messages")
        .select("direction, sender")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (!fresh?.ai_enabled && lead.ai_enabled) return;
      // Archivos que envió la propia IA en esta respuesta (p. ej. la ficha de pago) no cuentan como respuesta de un asesor
      if (lastMsg?.direction === "out" && lastMsg.sender !== "ai") return;

      const idMessage = await sendText(lead.wa_chat_id, reply);
      const now = new Date().toISOString();
      await db.from("messages").insert({
        lead_id: leadId,
        direction: "out",
        sender: "ai",
        type: "text",
        body: reply,
        wa_message_id: idMessage,
        status: "sent",
      });
      await db.from("leads").update({ last_message_at: now }).eq("id", leadId);
    } finally {
      await releaseLock(db, leadId);
    }

    // ¿Llegó otro mensaje mientras generábamos? Entonces respondemos de nuevo.
    const { data: newer } = await db
      .from("messages")
      .select("id")
      .eq("lead_id", leadId)
      .eq("direction", "in")
      .gt("created_at", answeredUpTo ?? new Date(0).toISOString())
      .limit(1);
    if (!newer?.length) return;
  }
}
