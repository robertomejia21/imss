import { after, NextResponse } from "next/server";
import { storeWebhook, processMedia } from "@/lib/whatsapp/inbound";
import { getAgentSettings, replyToLead } from "@/lib/ai/agent";
import { createAdminClient } from "@/lib/supabase/admin";
import { renewExpiredSigningLinks } from "@/lib/authorization-form";
import type { GreenWebhook } from "@/lib/whatsapp/green-api";

// El OCR + la respuesta de la IA pueden tardar; en Vercel esto requiere plan con funciones largas.
export const maxDuration = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastSigningCheck = 0;

/**
 * Webhook de Green API.
 * Configúralo en la consola de Green API (o desde /configuracion) con:
 *   URL:   https://TU-DOMINIO/api/webhooks/green-api
 *   Token: el valor de GREEN_API_WEBHOOK_TOKEN
 */
export async function POST(request: Request) {
  const expected = process.env.GREEN_API_WEBHOOK_TOKEN?.trim();
  if (expected) {
    // Green API manda el token en Authorization, con o sin el prefijo "Bearer"
    const received = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (received !== expected) {
      console.warn("[green-api webhook] token inválido o ausente");
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  let payload: GreenWebhook;
  try {
    payload = (await request.json()) as GreenWebhook;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const result = await storeWebhook(payload);

  // Aprovecha el tráfico del webhook para renovar enlaces de firma vencidos (como mucho cada 10 minutos por instancia)
  if (Date.now() - lastSigningCheck > 10 * 60_000) {
    lastSigningCheck = Date.now();
    after(() => renewExpiredSigningLinks(createAdminClient()).catch((e) => console.error("[firma] renovación", e)));
  }

  // Responder 200 de inmediato a Green API y procesar en segundo plano
  if (result.kind !== "ignored") {
    after(async () => {
      try {
        if (result.kind === "media") {
          await processMedia(result.messageId);
        } else {
          // Espera unos segundos para agrupar mensajes enviados en ráfaga
          const settings = await getAgentSettings(createAdminClient());
          await sleep((settings?.reply_delay_seconds ?? 6) * 1000);
        }
        await replyToLead(result.leadId);
      } catch (e) {
        console.error("[green-api webhook]", e);
      }
    });
  }

  return NextResponse.json({ ok: true });
}

export function GET() {
  return NextResponse.json({ ok: true, service: "green-api webhook" });
}
