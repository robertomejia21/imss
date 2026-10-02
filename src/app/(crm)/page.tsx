import Link from "next/link";
import { AlertTriangle, FileWarning, MessageCircle, UserPlus, Users, Workflow } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Avatar, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { LeadStatusBadge } from "@/components/status-badge";
import { LEAD_STATUSES } from "@/lib/constants";
import { displayName, timeAgo } from "@/lib/utils";
import type { Lead, LeadStatus } from "@/lib/types";

export const metadata = { title: "Inicio" };

const SOURCE_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp directo",
  formulario: "Formulario web",
  facebook: "Facebook",
  manual: "Manual",
  api: "Integración",
};

const daysAgoIso = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();

export default async function DashboardPage() {
  const supabase = await createClient();
  const weekAgo = daysAgoIso(7);

  const [{ data: leads }, { count: docsToReview }, { data: recent }, { data: human }] = await Promise.all([
    supabase.from("leads").select("status, source, created_at"),
    supabase
      .from("documents")
      .select("id", { count: "exact", head: true })
      .in("status", ["con_observaciones", "invalido"])
      .is("reviewed_at", null),
    supabase.from("leads").select("*").not("last_message_at", "is", null).order("last_message_at", { ascending: false }).limit(6),
    supabase.from("leads").select("*").eq("needs_human", true).order("updated_at", { ascending: false }).limit(5),
  ]);

  const all = (leads ?? []) as Pick<Lead, "status" | "source" | "created_at">[];
  const byStatus = (s: LeadStatus) => all.filter((l) => l.status === s).length;
  const newThisWeek = all.filter((l) => l.created_at >= weekAgo).length;
  const recentLeads = (recent ?? []) as Lead[];
  const humanLeads = (human ?? []) as Lead[];

  const kpis = [
    { label: "Prospectos totales", value: all.length, icon: Users },
    { label: "Nuevos esta semana", value: newThisWeek, icon: UserPlus },
    { label: "Registro completo", value: byStatus("registro_completo"), icon: MessageCircle },
    { label: "En trámite", value: byStatus("en_tramite"), icon: Workflow },
    { label: "Requieren asesor", value: humanLeads.length, icon: AlertTriangle, warn: true },
    { label: "Docs. por revisar", value: docsToReview ?? 0, icon: FileWarning, warn: true },
  ];

  const funnel = LEAD_STATUSES.filter((s) => s.value !== "descartado").map((s) => ({ ...s, count: byStatus(s.value) }));
  const maxFunnel = Math.max(1, ...funnel.map((f) => f.count));

  const sources = Object.entries(
    all.reduce<Record<string, number>>((acc, l) => {
      acc[l.source] = (acc[l.source] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <PageHeader title="Inicio" description="Resumen de prospectos, conversaciones y trámites." />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map(({ label, value, icon: Icon, warn }) => (
          <Card key={label} className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted">{label}</p>
              <Icon className={warn && value > 0 ? "size-4 text-amber-600" : "size-4 text-brand-400"} />
            </div>
            <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-ink">{value}</p>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Embudo de prospectos"
            action={
              <Link href="/pipeline" className="text-xs font-medium text-brand-600 hover:underline">
                Ver embudo
              </Link>
            }
          />
          <div className="space-y-2.5 p-5">
            {funnel.map((f) => (
              <Link
                key={f.value}
                href={`/leads?status=${f.value}`}
                className="group grid grid-cols-[8rem_1fr_2.5rem] items-center gap-3 sm:grid-cols-[10rem_1fr_2.5rem]"
                title={`${f.label}: ${f.count}`}
              >
                <span className="truncate text-sm text-muted group-hover:text-ink">{f.label}</span>
                <span className="h-6 rounded-r bg-stone-100">
                  <span
                    className="block h-full rounded-r bg-brand-500 transition-colors group-hover:bg-brand-600"
                    style={{ width: `${(f.count / maxFunnel) * 100}%`, minWidth: f.count ? 4 : 0 }}
                  />
                </span>
                <span className="text-right text-sm font-medium tabular-nums text-ink">{f.count}</span>
              </Link>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Origen de prospectos" />
          {sources.length === 0 && <EmptyState title="Sin datos aún" />}
          <ul className="divide-y divide-line">
            {sources.map(([src, n]) => (
              <li key={src} className="flex items-center justify-between px-5 py-3 text-sm">
                <span className="text-ink">{SOURCE_LABEL[src] ?? src}</span>
                <span className="tabular-nums text-muted">
                  {n} <span className="text-xs">({Math.round((n / all.length) * 100)}%)</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Conversaciones recientes"
            action={
              <Link href="/inbox" className="text-xs font-medium text-brand-600 hover:underline">
                Abrir bandeja
              </Link>
            }
          />
          {recentLeads.length === 0 && (
            <EmptyState title="Aún no hay conversaciones" description="Cuando alguien escriba a tu WhatsApp aparecerá aquí." />
          )}
          <ul className="divide-y divide-line">
            {recentLeads.map((l) => (
              <li key={l.id}>
                <Link href={`/inbox?lead=${l.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-stone-50">
                  <Avatar name={displayName(l)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{displayName(l)}</p>
                    <p className="truncate text-xs text-muted">{l.tramite_type ?? "Trámite sin definir"}</p>
                  </div>
                  <span className="hidden sm:inline">
                    <LeadStatusBadge status={l.status} />
                  </span>
                  <span className="w-20 text-right text-xs text-muted">{timeAgo(l.last_message_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Requieren asesor" />
          {humanLeads.length === 0 && <EmptyState title="Todo en orden" description="La IA está atendiendo a todos." />}
          <ul className="divide-y divide-line">
            {humanLeads.map((l) => (
              <li key={l.id}>
                <Link href={`/inbox?lead=${l.id}`} className="block px-5 py-3 hover:bg-stone-50">
                  <p className="text-sm font-medium text-ink">{displayName(l)}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-amber-700">{l.needs_human_reason}</p>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
