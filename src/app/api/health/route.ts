import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Diagnóstico de configuración. Solo indica si cada variable existe y si
 * Supabase responde; nunca devuelve los valores.
 */
export async function GET() {
  const has = (k: string) => Boolean(process.env[k]?.trim());
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

  const env = Object.fromEntries(
    [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "GREEN_API_ID_INSTANCE",
      "GREEN_API_TOKEN_INSTANCE",
      "GREEN_API_WEBHOOK_TOKEN",
      "NEXT_PUBLIC_WHATSAPP_NUMBER",
      "NEXT_PUBLIC_APP_URL",
      "INTAKE_API_KEY",
    ].map((k) => [k, has(k)]),
  );

  const checks: Record<string, string> = {
    supabase_url_formato: /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(supabaseUrl)
      ? "ok"
      : "inválido (debe ser https://xxxx.supabase.co)",
  };

  if (checks.supabase_url_formato === "ok" && has("SUPABASE_SERVICE_ROLE_KEY")) {
    try {
      const db = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
      const { error } = await db.from("agent_settings").select("id").limit(1);
      checks.supabase_base_de_datos = error
        ? `error: ${error.message}${error.code === "42P01" || error.code === "PGRST205" ? " (¿ejecutaste la migración SQL?)" : ""}`
        : "ok";
    } catch (e) {
      checks.supabase_base_de_datos = `error: ${(e as Error).message}`;
    }
  }

  const ok = Object.values(env).every(Boolean) && Object.values(checks).every((v) => v === "ok");
  return NextResponse.json({ ok, env, checks }, { status: ok ? 200 : 500 });
}
