"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizationData, leadBySigningToken, missingAuthorizationFields, renderAuthorizationPdf } from "@/lib/authorization-form";
import { isGreenApiConfigured, sendFileByUrl } from "@/lib/whatsapp/green-api";
import { formatPhone } from "@/lib/utils";

const COPY_URL_SECONDS = 7 * 24 * 3600;

/** Firma del formato de autorización desde el enlace que envía el agente. */
export async function signAuthorization(token: string, signatureDataUrl: string, accepted: boolean): Promise<{ error?: string; ok?: true }> {
  if (!accepted) return { error: "Para firmar, marca la casilla de autorización." };
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(signatureDataUrl);
  const png = m ? Buffer.from(m[1]!, "base64") : null;
  if (!png || png.length < 800) return { error: "Dibuja tu firma en el recuadro." };
  if (png.length > 1_500_000) return { error: "La firma es demasiado grande; bórrala e inténtalo de nuevo." };

  const db = createAdminClient();
  const lead = await leadBySigningToken(db, token);
  if (!lead) return { error: "Este enlace ya no es válido. Pide uno nuevo por WhatsApp." };
  const data = authorizationData(lead);
  if (missingAuthorizationFields(data).length) return { error: "Faltan datos en tu formato. Escríbenos por WhatsApp." };

  const now = new Date();
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const when = now.toLocaleString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "short", timeStyle: "short" });
  const evidence = `Firmado electrónicamente el ${when} (CDMX) desde el enlace enviado al WhatsApp ${formatPhone(lead.phone)}. Folio ${lead.folio}.`;

  const pdf = await renderAuthorizationPdf(data, { date: now, signaturePng: png, evidence });
  const path = `${lead.id}/autorizacion-firmada-${now.getTime()}.pdf`;
  const { error: upErr } = await db.storage.from("media").upload(path, pdf, { contentType: "application/pdf" });
  if (upErr) return { error: "No pudimos guardar tu firma. Inténtalo de nuevo." };

  const firma = { fecha: now.toISOString(), ip, user_agent: h.get("user-agent"), telefono: lead.phone, nombre: data.nombre, numero_empleado_rfc: data.numeroEmpleadoRfc };
  await db.from("documents").insert({
    lead_id: lead.id,
    storage_path: path,
    mime: "application/pdf",
    doc_type: "formato_autorizacion",
    status: "valido",
    issues: [],
    confidence: 1,
    extracted: {
      firma_electronica: firma,
      summary: `Formato de autorización de consulta (Nomi-Pay) FIRMADO por el cliente en el enlace seguro el ${when}, con nombre ${data.nombre} y número de empleado/RFC ${data.numeroEmpleadoRfc}. Ya no hace falta que lo imprima ni lo mande en foto.`,
    },
  });

  // Copia al cliente por WhatsApp
  if (lead.wa_chat_id && isGreenApiConfigured()) {
    const { data: signed } = await db.storage.from("media").createSignedUrl(path, COPY_URL_SECONDS);
    if (signed) {
      try {
        const fileName = "Autorizacion-firmada-Nomipay.pdf";
        const idMessage = await sendFileByUrl(lead.wa_chat_id, signed.signedUrl, fileName, "¡Listo! ✅ Recibimos tu formato de autorización firmado. Aquí tienes tu copia.");
        await db.from("messages").insert({
          lead_id: lead.id,
          direction: "out",
          sender: "ai",
          type: "document",
          body: "Formato de autorización FIRMADO por el cliente (copia enviada)",
          media_path: path,
          media_mime: "application/pdf",
          wa_message_id: idMessage,
          status: "sent",
          meta: { fileName, kind: "formato_autorizacion_firmado" },
        });
      } catch (e) {
        console.error("[firma] no se pudo enviar la copia", e);
      }
    }
  }

  const { prestamo_firma: _used, ...rest } = lead.captured_data as Record<string, unknown>;
  void _used;
  await db
    .from("leads")
    .update({
      captured_data: { ...rest, prestamo_formato_firmado: now.toISOString() },
      needs_human: true,
      needs_human_reason: "Préstamo vía nómina: formato de autorización firmado. Revisar INE y talón y solicitar capacidad.",
      last_message_at: now.toISOString(),
    })
    .eq("id", lead.id);
  await db.from("activities").insert({
    lead_id: lead.id,
    kind: "document",
    content: `Cliente firmó electrónicamente el formato de autorización (Nomi-Pay)${ip ? ` desde la IP ${ip}` : ""}`,
    meta: { path, firma },
  });
  return { ok: true };
}
