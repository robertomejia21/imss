import { createAdminClient } from "@/lib/supabase/admin";
import { authorizationData, leadBySigningToken, renderAuthorizationPdf } from "@/lib/authorization-form";

/** Vista previa del formato ya llenado (sin firma). */
export async function GET(_req: Request, ctx: RouteContext<"/firma/[token]/pdf">) {
  const { token } = await ctx.params;
  const lead = await leadBySigningToken(createAdminClient(), token);
  if (!lead) return new Response("Enlace no válido o vencido", { status: 404 });
  const pdf = await renderAuthorizationPdf(authorizationData(lead));
  return new Response(Buffer.from(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="Autorizacion-de-consulta.pdf"', "Cache-Control": "no-store" },
  });
}
