import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TRAMITE_TYPES } from "@/lib/constants";
import type { Product, Tramite, TramiteStatus } from "@/lib/types";

/**
 * Productos (servicios) que ofrecemos. Un prospecto puede pedir información o
 * registrarse en varios: cada uno es una fila en "tramites" (tipo = nombre del producto).
 */

const CLOSED: TramiteStatus[] = ["resuelto", "rechazado", "cancelado"];
const OFFERED_BY_AI_DEFAULT = ["Alta en IMSS", "Retiro por desempleo", "Salario Topado"];

/** Catálogo ordenado. Si la tabla aún no existe, usa la lista fija de constants.ts. */
export async function getProducts(db: SupabaseClient, { activeOnly = true } = {}): Promise<Product[]> {
  let query = db.from("products").select("*").order("sort_order").order("name");
  if (activeOnly) query = query.eq("active", true);
  const { data, error } = await query;
  if (!error && data) return data as Product[];
  return TRAMITE_TYPES.map((name, i) => ({
    id: name,
    name,
    description: "",
    offered_by_ai: OFFERED_BY_AI_DEFAULT.includes(name),
    active: true,
    sort_order: i,
    created_at: "",
  }));
}

export const isOpenTramite = (t: Pick<Tramite, "status">) => !CLOSED.includes(t.status);

/**
 * Agrega un producto al prospecto, o lo avanza si ya lo tenía abierto:
 * "interesado" (pidió información) → "pendiente" (registrado). Nunca lo regresa.
 */
export async function addProductToLead(
  db: SupabaseClient,
  leadId: string,
  product: string,
  status: "interesado" | "pendiente",
  opts: { notes?: string | null; createdBy?: string | null } = {},
): Promise<{ result: "creado" | "actualizado" | "sin_cambios"; tramite?: Tramite; error?: string }> {
  const name = product.trim();
  if (!name) return { result: "sin_cambios", error: "Producto vacío" };

  const { data: rows } = await db.from("tramites").select("*").eq("lead_id", leadId).ilike("tipo", name.replace(/[%_\\]/g, "\\$&"));
  const open = ((rows as Tramite[] | null) ?? []).find(isOpenTramite);

  if (open) {
    const upgrade = open.status === "interesado" && status === "pendiente";
    const notes = opts.notes && !open.notes?.includes(opts.notes) ? [open.notes, opts.notes].filter(Boolean).join("\n") : undefined;
    if (!upgrade && !notes) return { result: "sin_cambios", tramite: open };
    const { data, error } = await db
      .from("tramites")
      .update({ ...(upgrade ? { status } : {}), ...(notes ? { notes } : {}) })
      .eq("id", open.id)
      .select("*")
      .single<Tramite>();
    if (error) return { result: "sin_cambios", tramite: open, error: error.message };
    return { result: upgrade ? "actualizado" : "sin_cambios", tramite: data };
  }

  const { data, error } = await db
    .from("tramites")
    .insert({ lead_id: leadId, tipo: name, status, notes: opts.notes ?? null, created_by: opts.createdBy ?? null })
    .select("*")
    .single<Tramite>();
  if (error) return { result: "sin_cambios", error: error.message };
  return { result: "creado", tramite: data };
}

/**
 * La persona ya se comprometió con el trámite (aceptó el aviso de privacidad o mandó documentos):
 * su producto pasa de "pidió información" a "registrado" aunque la IA no lo haya marcado.
 * Si no se indica el producto y tiene varios en "pidió información", no se adivina cuál.
 */
export async function promoteInterestedProduct(db: SupabaseClient, leadId: string, reason: string, product?: string) {
  const { data } = await db.from("tramites").select("id, tipo, status").eq("lead_id", leadId).eq("status", "interesado");
  const rows = (data ?? []) as Pick<Tramite, "id" | "tipo" | "status">[];
  const target = product ? rows.find((t) => t.tipo.toLowerCase() === product.toLowerCase()) : rows.length === 1 ? rows[0] : undefined;
  if (!target) return;
  const { error } = await db.from("tramites").update({ status: "pendiente" }).eq("id", target.id).eq("status", "interesado");
  if (error) return;
  await db.from("activities").insert({ lead_id: leadId, kind: "tramite", content: `${target.tipo}: pidió información → registrado (${reason})` });
}
