import { NextResponse } from "next/server";
import { IntakeSchema, upsertLeadFromIntake } from "@/lib/leads";

/**
 * Alta de leads desde integraciones externas (Zapier, Make, Meta Lead Ads, otra landing).
 *
 * POST /api/leads
 * Headers: x-api-key: <INTAKE_API_KEY>
 * Body: { full_name, phone, email?, curp?, nss?, tramite_type?, message?, source?, utm?, extra?, send_whatsapp? }
 */
export async function POST(request: Request) {
  const key = process.env.INTAKE_API_KEY;
  if (!key || request.headers.get("x-api-key") !== key) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = IntakeSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  try {
    const lead = await upsertLeadFromIntake({ ...parsed.data, source: parsed.data.source || "api" });
    return NextResponse.json({ id: lead.id, folio: lead.folio });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
