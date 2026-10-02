import { after, NextResponse } from "next/server";
import { storeWebhook, processMedia } from "@/lib/whatsapp/inbound";
import { getAgentSettings, replyToLead } from "@/lib/ai/agent";
import { createAdminClient } from "@/lib/supabase/admin";
import type { GreenWebhook } from "@/lib/whatsapp/green-api";

// El OCR + la respuesta de la IA pueden tardar; en Vercel esto requiere plan con funciones largas.
export const maxDuration = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Webhook de Green API.
 * Configúralo en la consola de Green API (o desde /configuracion) con:
 *   URL:   https://TU-DOMINIO/api/webhooks/green-api
 *   Token: el valor de GREEN_API_WEBHOOK_TOKEN
 */
export async function POST(request: Request) {
  const expected = process.env.GREEN_API_WEBHOOK_TOKEN;
  if (expected && request.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: GreenWebhook;
  try {
    payload = (await request.json()) as GreenWebhook;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const result = await storeWebhook(payload);

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
