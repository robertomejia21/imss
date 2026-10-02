import Link from "next/link";
import { Bot, Plus, Search, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createLead } from "../actions";
import { Avatar, Button, Card, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui";
import { LeadStatusBadge } from "@/components/status-badge";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { LEAD_STATUSES, TRAMITE_TYPES } from "@/lib/constants";
import { displayName, formatDate, formatPhone, timeAgo } from "@/lib/utils";
import type { Lead } from "@/lib/types";

export const metadata = { title: "Prospectos" };

const SOURCES = ["whatsapp", "formulario", "facebook", "manual", "api"];

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const sp = await searchParams;
  const status = typeof sp.status === "string" ? sp.status : "";
  const source = typeof sp.source === "string" ? sp.source : "";
  const q = typeof sp.q === "string" ? sp.q.replace(/[,()%*]/g, " ").trim() : "";

  const supabase = await createClient();
  let query = supabase.from("leads").select("*").order("created_at", { ascending: false }).limit(200);
  if (status) query = query.eq("status", status);
  if (source) query = query.eq("source", source);
  if (q) query = query.or(`full_name.ilike.%${q}%,wa_name.ilike.%${q}%,phone.ilike.%${q}%,folio.ilike.%${q}%,curp.ilike.%${q}%,nss.ilike.%${q}%`);
  const { data } = await query;
  const leads = (data ?? []) as Lead[];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <RealtimeRefresh channel="leads-list" tables={["leads"]} />
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
                <Field label="Trámite">
                  <Select name="tramite_type" defaultValue="">
                    <option value="">Sin definir</option>
                    {TRAMITE_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </Select>
                </Field>
                <Button className="w-full">Crear</Button>
              </form>
            </Card>
          </details>
        }
      />

      <form className="mb-4 flex flex-wrap gap-2" action="/leads">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
          <Input name="q" defaultValue={q} placeholder="Nombre, teléfono, folio, CURP o NSS" className="pl-9" />
        </div>
        <Select name="status" defaultValue={status} className="w-auto">
          <option value="">Todos los estados</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <Select name="source" defaultValue={source} className="w-auto">
          <option value="">Todos los orígenes</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Button variant="secondary">Filtrar</Button>
      </form>

      <Card className="overflow-hidden">
        {leads.length === 0 ? (
          <EmptyState icon={<Users className="size-10" />} title="No hay prospectos" description="Ajusta los filtros o espera a que lleguen nuevos registros." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b border-line bg-stone-50/70 text-left text-xs font-medium text-muted">
                <tr>
                  <th className="px-5 py-3">Prospecto</th>
                  <th className="px-3 py-3">Trámite</th>
                  <th className="px-3 py-3">Estado</th>
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
                            {!l.ai_enabled && <Bot className="size-3.5 text-stone-400" aria-label="IA en pausa" />}
                            {l.needs_human && <span className="size-2 rounded-full bg-amber-500" title="Requiere asesor" />}
                          </p>
                          <p className="text-xs text-muted">
                            {formatPhone(l.phone)} · {l.folio}
                          </p>
                        </div>
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-muted">{l.tramite_type ?? "—"}</td>
                    <td className="px-3 py-3">
                      <LeadStatusBadge status={l.status} />
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
