import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { downloadMedia, getDownloadUrl, type GreenWebhook } from "./green-api";
import { transcribeAudio } from "@/lib/ai/transcribe";
import { evaluateDocument, extractDocument, isOcrSupported, ocrSummaryForAgent } from "@/lib/ai/ocr";
import { phoneFromChatId } from "@/lib/utils";
import type { Lead, Message, MessageType } from "@/lib/types";

type Db = ReturnType<typeof createAdminClient>;

const FOLIO_RE = /REG-[A-Z0-9]{6}/i;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "video/mp4": "mp4",
};

function parseContent(data: NonNullable<GreenWebhook["messageData"]>): { type: MessageType; body: string | null } {
  const file = data.fileMessageData;
  switch (data.typeMessage) {
    case "textMessage":
      return { type: "text", body: data.textMessageData?.textMessage ?? "" };
    case "extendedTextMessage":
    case "quotedMessage":
      return { type: "text", body: data.extendedTextMessageData?.text ?? data.textMessageData?.textMessage ?? "" };
    case "imageMessage":
      return { type: "image", body: file?.caption || null };
    case "audioMessage":
      return { type: "audio", body: null };
    case "documentMessage":
      return { type: "document", body: file?.caption || file?.fileName || null };
    case "videoMessage":
      return { type: "video", body: file?.caption || null };
    case "locationMessage": {
      const l = data.locationMessageData;
      return { type: "location", body: l ? `${l.nameLocation ?? ""} ${l.address ?? ""} (${l.latitude}, ${l.longitude})`.trim() : null };
    }
    case "buttonsResponseMessage":
      return { type: "text", body: data.buttonsResponseMessage?.selectedButtonText ?? "" };
    case "listResponseMessage":
      return { type: "text", body: data.listResponseMessage?.title ?? "" };
    case "contactMessage":
      return { type: "other", body: `[Contacto] ${data.contactMessageData?.displayName ?? ""}` };
    default:
      return { type: "other", body: `[${data.typeMessage}]` };
  }
}

/** Busca el lead por chatId, teléfono o folio del formulario; si no existe, lo crea. */
async function findOrCreateLead(db: Db, chatId: string, waName: string | undefined, text: string | null): Promise<Lead> {
  const phone = phoneFromChatId(chatId);

  const { data: byChat } = await db.from("leads").select("*").eq("wa_chat_id", chatId).maybeSingle<Lead>();
  if (byChat) return byChat;

  // El lead pudo llegar antes por el formulario (con teléfono o con folio en el mensaje)
  // Comparamos los últimos 10 dígitos: en México WhatsApp puede usar 52 o 521 como prefijo
  const { data: phoneMatches } = await db
    .from("leads")
    .select("*")
    .like("phone", `%${phone.slice(-10)}`)
    .is("wa_chat_id", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const byPhone = (phoneMatches?.[0] as Lead | undefined) ?? null;
  const folio = text?.match(FOLIO_RE)?.[0]?.toUpperCase();
  const { data: byFolio } = !byPhone && folio
    ? await db.from("leads").select("*").eq("folio", folio).is("wa_chat_id", null).maybeSingle<Lead>()
    : { data: null };

  const existing = byPhone ?? byFolio;
  if (existing) {
    const { data } = await db
      .from("leads")
      .update({ wa_chat_id: chatId, phone, wa_name: waName ?? existing.wa_name })
      .eq("id", existing.id)
      .select("*")
      .single<Lead>();
    await db.from("activities").insert({
      lead_id: existing.id,
      kind: "system",
      content: `Se vinculó WhatsApp ${phone} al registro ${existing.folio}`,
    });
    return data!;
  }

  const { data: created, error } = await db
    .from("leads")
    .insert({ wa_chat_id: chatId, phone, wa_name: waName ?? null, source: "whatsapp", status: "nuevo" })
    .select("*")
    .single<Lead>();
  if (error) {
    // Carrera: otro webhook lo creó al mismo tiempo
    const { data: again } = await db.from("leads").select("*").eq("wa_chat_id", chatId).single<Lead>();
    return again!;
  }
  await db.from("activities").insert({ lead_id: created!.id, kind: "system", content: "Nuevo contacto por WhatsApp" });
  return created!;
}

export type InboundResult =
  | { kind: "ignored" }
  | { kind: "text"; leadId: string }
  | { kind: "media"; leadId: string; messageId: string };

/** Guarda en BD lo que llega por el webhook. Rápido: no llama a la IA. */
export async function storeWebhook(payload: GreenWebhook): Promise<InboundResult> {
  const db = createAdminClient();

  if (payload.typeWebhook === "outgoingMessageStatus" && payload.idMessage) {
    await db.from("messages").update({ status: payload.status }).eq("wa_message_id", payload.idMessage);
    return { kind: "ignored" };
  }

  const chatId = payload.senderData?.chatId;
  if (!chatId || !payload.messageData || !payload.idMessage) return { kind: "ignored" };
  if (!chatId.endsWith("@c.us")) return { kind: "ignored" }; // grupos, canales, estados

  // Mensaje escrito desde el teléfono del negocio (fuera del CRM): lo registramos como asesor
  if (payload.typeWebhook === "outgoingMessageReceived") {
    const { data: lead } = await db.from("leads").select("id").eq("wa_chat_id", chatId).maybeSingle();
    if (!lead) return { kind: "ignored" };
    const { type, body } = parseContent(payload.messageData);
    await db
      .from("messages")
      .upsert(
        { lead_id: lead.id, direction: "out", sender: "agent", type, body, wa_message_id: payload.idMessage, status: "sent" },
        { onConflict: "wa_message_id", ignoreDuplicates: true },
      );
    await db.from("leads").update({ last_message_at: new Date().toISOString() }).eq("id", lead.id);
    return { kind: "ignored" };
  }

  if (payload.typeWebhook !== "incomingMessageReceived") return { kind: "ignored" };

  const { type, body } = parseContent(payload.messageData);
  const waName = payload.senderData?.senderName || payload.senderData?.chatName;
  const lead = await findOrCreateLead(db, chatId, waName, body);

  const isMedia = type === "image" || type === "audio" || type === "document";
  const file = payload.messageData.fileMessageData;

  const { data: inserted, error } = await db
    .from("messages")
    .insert({
      lead_id: lead.id,
      direction: "in",
      sender: "lead",
      type,
      body,
      wa_message_id: payload.idMessage,
      media_mime: file?.mimeType?.split(";")[0] ?? null,
      meta: isMedia ? { processing: true, downloadUrl: file?.downloadUrl, fileName: file?.fileName } : {},
    })
    .select("id")
    .single();
  if (error || !inserted) return { kind: "ignored" }; // duplicado (Green API reintenta)

  const now = new Date().toISOString();
  await db
    .from("leads")
    .update({
      last_message_at: now,
      last_inbound_at: now,
      unread_count: (lead.unread_count ?? 0) + 1,
      wa_name: waName ?? lead.wa_name,
      ...(lead.status === "nuevo" ? { status: "en_conversacion" } : {}),
    })
    .eq("id", lead.id);

  return isMedia ? { kind: "media", leadId: lead.id, messageId: inserted.id } : { kind: "text", leadId: lead.id };
}

/** Descarga el archivo, lo guarda en Storage y lo transcribe (audio) o le hace OCR (imagen/PDF). */
export async function processMedia(messageId: string) {
  const db = createAdminClient();
  const { data: msg } = await db.from("messages").select("*").eq("id", messageId).single<Message>();
  if (!msg) return;
  const { data: lead } = await db.from("leads").select("*").eq("id", msg.lead_id).single<Lead>();
  if (!lead) return;

  const meta = { ...msg.meta };
  try {
    let downloadUrl = meta.downloadUrl as string | undefined;
    if (!downloadUrl && lead.wa_chat_id && msg.wa_message_id) downloadUrl = await getDownloadUrl(lead.wa_chat_id, msg.wa_message_id);
    if (!downloadUrl) throw new Error("El mensaje no trae URL de descarga");

    const { buffer, contentType } = await downloadMedia(downloadUrl);
    const mime = (msg.media_mime || contentType).split(";")[0]!.trim();
    const path = `${lead.id}/${msg.id}.${EXT[mime] ?? "bin"}`;
    await db.storage.from("media").upload(path, buffer, { contentType: mime, upsert: true });
    await db.from("messages").update({ media_path: path, media_mime: mime }).eq("id", msg.id);

    if (msg.type === "audio") {
      const text = await transcribeAudio(buffer, mime, `audio.${EXT[mime] ?? "ogg"}`);
      await db.from("messages").update({ transcription: text }).eq("id", msg.id);
    } else {
      const { data: doc } = await db
        .from("documents")
        .insert({ lead_id: lead.id, message_id: msg.id, storage_path: path, mime, status: "procesando" })
        .select("id")
        .single();

      if (!isOcrSupported(mime)) {
        await db
          .from("documents")
          .update({
            status: "error",
            issues: [`Formato ${mime} no soportado para verificación automática`],
            extracted: { summary: `Archivo en formato ${mime}: no se puede leer automáticamente. Pide una foto o PDF.` },
          })
          .eq("id", doc!.id);
      } else {
        const ocr = await extractDocument(buffer, mime);
        const { status, issues } = evaluateDocument(ocr, lead);
        await db
          .from("documents")
          .update({
            doc_type: ocr.tipo_documento,
            status,
            issues,
            confidence: ocr.confianza,
            extracted: { ...ocr, summary: ocrSummaryForAgent(ocr, status, issues) },
          })
          .eq("id", doc!.id);

        // Completa datos vacíos del lead con lo leído en documentos válidos
        if (status !== "invalido") {
          const fill: Partial<Lead> = {};
          if (!lead.full_name && ocr.nombre_completo) fill.full_name = ocr.nombre_completo;
          if (!lead.curp && ocr.curp) fill.curp = ocr.curp.toUpperCase();
          if (!lead.nss && ocr.nss) fill.nss = ocr.nss.replace(/\D/g, "");
          if (!lead.rfc && ocr.rfc) fill.rfc = ocr.rfc.toUpperCase();
          if (!lead.birth_date && ocr.fecha_nacimiento && /^\d{4}-\d{2}-\d{2}$/.test(ocr.fecha_nacimiento))
            fill.birth_date = ocr.fecha_nacimiento;
          if (Object.keys(fill).length) await db.from("leads").update(fill).eq("id", lead.id);
        }
        await db.from("activities").insert({
          lead_id: lead.id,
          kind: "document",
          content: `Documento recibido (${ocr.tipo_documento}) → ${status}${issues.length ? `: ${issues.join("; ")}` : ""}`,
        });
      }
    }
    delete meta.processing;
    delete meta.downloadUrl;
  } catch (e) {
    console.error("[processMedia]", e);
    delete meta.processing;
    meta.error = (e as Error).message;
    await db.from("documents").update({ status: "error", issues: [(e as Error).message] }).eq("message_id", msg.id).eq("status", "procesando");
  }
  await db.from("messages").update({ meta }).eq("id", msg.id);
}
