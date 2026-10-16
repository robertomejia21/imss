import Link from "next/link";
import { Bot, Plus, Search, UserRound, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createLead } from "../actions";
import { Avatar, Button, Card, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui";
import { TramiteProgress } from "@/components/status-badge";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { TRAMITE_STATUSES } from "@/lib/constants";
import { getProducts } from "@/lib/products";
import { displayName, formatDate, formatPhone, timeAgo } from "@/lib/utils";
import type { Lead, Tramite, TramiteStatus } from "@/lib/types";

type LeadRow = Lead & { tramites: Pick<Tramite, "id" | "tipo" | "status" | "created_at">[] };

export const metadata = { title: "Prospectos" };

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const sp = await searchParams;
  const fase = typeof sp.fase === "string" && sp.fase in TRAMITE_STATUSES ? (sp.fase as TramiteStatus) : "";
  const product = typeof sp.product === "string" ? sp.product : "";
  const q = typeof sp.q === "string" ? sp.q.replace(/[,()%*]/g, " ").trim() : "";

  const supabase = await createClient();
  let query = supabase.from("leads").select("*, tramites(id, tipo, status, created_at)").order("created_at", { ascending: false }).limit(200);
  if (product || fase) {
    // Prospectos con ese producto y/o un producto en esa fase (sin cancelados, salvo que se filtre por esa fase)
    let t = supabase.from("tramites").select("lead_id");
    if (product) t = t.eq("tipo", product);
    t = fase ? t.eq("status", fase) : t.neq("status", "cancelado");
    const { data: rows } = await t;
    query = query.in("id", [...new Set((rows ?? []).map((r) => r.lead_id as string))]);
  }
  if (q) query = query.or(`full_name.ilike.%${q}%,wa_name.ilike.%${q}%,phone.ilike.%${q}%,folio.ilike.%${q}%,curp.ilike.%${q}%,nss.ilike.%${q}%`);
  const [{ data }, products] = await Promise.all([query, getProducts(supabase)]);
  const leads = (data ?? []) as LeadRow[];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <RealtimeRefresh channel="leads-list" tables={["leads", "tramites"]} />
      <PageHeader
        title="Prospectos"
        description={`${leads.length} resultado${leads.length === 1 ? "" : "s"}`}
        actions={
          <details className="group relative">
            <summary className="list-none">
              <span className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-brand-700">
                <Plus className="size-4" /> Nuevo prospecto
              </span>
            </summary>
            <Card className="absolute right-0 z-20 mt-2 w-80 p-4">
              <form action={createLead} className="space-y-3">
                <Field label="Nombre completo">
                  <Input name="full_name" required />
                </Field>
                <Field label="WhatsApp (10 dígitos)">
                  <Input name="phone" inputMode="tel" placeholder="55 1234 5678" />
                </Field>
                <fieldset>
                  <legend className="mb-1.5 text-sm font-medium text-ink">Le interesa</legend>
                  <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-line p-2 scrollbar-thin">
                    {products.map((p) => (
                      <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-stone-50">
                        <input type="checkbox" name="products" value={p.name} className="size-4 accent-brand-600" />
                        {p.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <Button className="w-full">Crear</Button>
              </form>
            </Card>
          </details>
        }
      />

      <form className="mb-4 flex flex-wrap items-center gap-2" action="/leads">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
          <Input name="q" defaultValue={q} placeholder="Nombre, teléfono, folio, CURP o NSS" className="pl-9" />
        </div>
        <div className="w-full sm:w-48">
          <Select name="fase" defaultValue={fase}>
            <option value="">Todas las fases</option>
            {Object.entries(TRAMITE_STATUSES).map(([v, m]) => (
              <option key={v} value={v}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-full sm:w-56">
          <Select name="product" defaultValue={product}>
            <option value="">Todos los trámites</option>
            {products.map((p) => (
              <option key={p.id} value={p.name}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <Button variant="secondary">Filtrar</Button>
      </form>

      <Card className="overflow-hidden">
        {leads.length === 0 ? (
          <EmptyState icon={<Users className="size-10" />} title="No hay prospectos" description="Ajusta los filtros o espera a que lleguen nuevos registros." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="border-b border-line bg-stone-50/70 text-left text-xs font-medium text-muted">
                <tr>
                  <th className="px-5 py-3">Prospecto</th>
                  <th className="px-3 py-3">Productos</th>
                  <th className="px-3 py-3">Origen</th>
                  <th className="px-3 py-3">CURP</th>
                  <th className="px-3 py-3">Último mensaje</th>
                  <th className="px-5 py-3">Alta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {leads.map((l) => (
                  <tr key={l.id} className="hover:bg-stone-50">
                    <td className="px-5 py-3">
                      <Link href={`/leads/${l.id}`} className="flex items-center gap-3">
                        <Avatar name={displayName(l)} className="size-8" />
                        <div>
                          <p className="flex items-center gap-1.5 font-medium text-ink">
                            {displayName(l)}
                            {l.ai_enabled ? (
                              <Bot className="size-3.5 text-brand-600" aria-label="Atiende la IA" />
                            ) : (
                              <UserRound className="size-3.5 text-stone-500" aria-label="Atiende un asesor" />
                            )}
                            {l.needs_human && <span className="size-2 rounded-full bg-amber-500" title="Requiere asesor" />}
                            {l.status === "descartado" && <span className="rounded-full bg-stone-100 px-1.5 text-[10px] font-medium text-stone-500">Descartado</span>}
                          </p>
                          <p className="text-xs text-muted">
                            {formatPhone(l.phone)} · {l.folio}
                          </p>
                        </div>
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <ProductPhases lead={l} />
                    </td>
                    <td className="px-3 py-3 capitalize text-muted">{l.source}</td>
                    <td className="px-3 py-3 font-mono text-xs text-muted">{l.curp ?? "—"}</td>
                    <td className="px-3 py-3 text-muted">{timeAgo(l.last_message_at)}</td>
                    <td className="px-5 py-3 text-muted">{formatDate(l.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Un renglón por producto con su fase. Los cancelados no se muestran. */
function ProductPhases({ lead }: { lead: LeadRow }) {
  const tramites = (lead.tramites ?? [])
    .filter((t) => t.status !== "cancelado")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (tramites.length === 0) return <span className="text-muted">{lead.tramite_type ?? "—"}</span>;
  return (
    <ul className="space-y-1.5">
      {tramites.map((t) => (
        <li key={t.id} className="grid grid-cols-[minmax(0,13rem)_auto] items-center gap-3">
          <span className="truncate text-ink" title={t.tipo}>
            {t.tipo}
          </span>
          <TramiteProgress status={t.status} />
        </li>
      ))}
    </ul>
  );
}
