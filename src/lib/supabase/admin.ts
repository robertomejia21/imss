import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Cliente con service role: omite RLS. Usar SOLO en el servidor
 * (webhooks de Green API, formulario público, procesos de IA).
 */
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
