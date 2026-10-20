import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { renewExpiredSigningLinks } from "@/lib/authorization-form";

/**
 * Renueva los enlaces de firma vencidos sin firmar (préstamo vía nómina).
 * Llamarlo cada hora (Vercel Cron o un cron externo) con: Authorization: Bearer CRON_SECRET
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const received = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!secret || received !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await renewExpiredSigningLinks(createAdminClient())) });
}
