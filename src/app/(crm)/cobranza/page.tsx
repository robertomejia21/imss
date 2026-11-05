import Link from "next/link";
import { HandCoins } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { CobranzaTable, type CobroGroup, type CobroLead } from "@/components/cobranza-table";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { Card, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { COBRO_STATUSES, cobroSaldo, isCobroOverdue, mxn } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Cobro, CobroStatus } from "@/lib/types";

export const metadata = { title: "Cobranza" };

const OPEN: CobroStatus[] = ["pendiente", "enviado", "parcial"];

export default async function CobranzaPage({ searchParams }: PageProps<"/cobranza">) {
  const sp = await searchParams;
  const status = typeof sp.status === "string" ? sp.status : "por_cobrar";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const asesor = typeof sp.asesor === "string" ? sp.asesor : "";
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });

  const supabase = await createClient();
  const [{ data, error }, { data: profiles }] = await Promise.all([
    supabase
      .from("cobros")
      .select("*, leads(id, folio, full_name, wa_name, phone, curp, nss, email)")
      .order("fecha_servicio", { ascending: false })
      .limit(1000),
    supabase.from("profiles").select("id, full_name, email"),
  ]);
  const advisors = (profiles ?? []).map((p) => ({ id: p.id as string, name: (p.full_name ?? p.email ?? "Asesor") as string }));

  type Row = Cobro & { leads: CobroLead | null };
  const all = ((data ?? []) as Row[]).filter((c) => c.leads);

  // Resumen (sobre todo, sin filtros)
  const active = all.filter((c) => c.status !== "cancelado");
  const porCobrar = active.reduce((s, c) => s + cobroSaldo(c), 0);
  const cobrado = active.reduce((s, c) => s + Number(c.monto_cobrado), 0);
  const vencidos = all.filter((c) => isCobroOverdue(c, today));
  const vencido = vencidos.reduce((s, c) => s + cobroSaldo(c), 0);
  const sinComision = all.filter((c) => OPEN.includes(c.status) && !(Number(c.comision) > 0)).length;

  // Filtros
  const needle = q.toLowerCase();
  const rows = all.filter((c) => {
    if (status === "por_cobrar" && !OPEN.includes(c.status)) return false;
    if (status === "vencidos" && !isCobroOverdue(c, today)) return false;
    if (status in COBRO_STATUSES && c.status !== status) return false;
    if (asesor && c.asesor_id !== asesor) return false;
    if (needle) {
      const l = c.leads!;
      const hay = [l.full_name, l.wa_name, l.phone, l.folio, l.curp, l.nss, c.servicio, c.referencia].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  // Un grupo por cliente: si logró varios servicios, cada uno es un renglón con su propio cobro
  const groups = new Map<string, CobroGroup>();
  for (const { leads: lead, ...c } of rows) {
    const g = groups.get(lead!.id) ?? { lead: lead!, cobros: [] };
    g.cobros.push(c as Cobro);
    groups.set(lead!.id, g);
  }

  const count = (key: string) =>
    key === "todos"
      ? all.length
      : key === "por_cobrar"
        ? all.filter((c) => OPEN.includes(c.status)).length
        : key === "vencidos"
          ? vencidos.length
          : all.filter((c) => c.status === key).length;
  const tabs = [
    { key: "por_cobrar", label: "Por cobrar" },
    { key: "vencidos", label: "Vencidos" },
    ...Object.entries(COBRO_STATUSES).map(([key, m]) => ({ key, label: m.label })),
    { key: "todos", label: "Todos" },
  ];
  const href = (s: string) => {
    const p = new URLSearchParams({ status: s });
    if (q) p.set("q", q);
    if (asesor) p.set("asesor", asesor);
    return `/cobranza?${p}`;
  };

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-8 sm:px-8">
      <RealtimeRefresh channel="cobranza" tables={["cobros"]} />
      <PageHeader
        title="Cobranza"
        description="Comisiones de los servicios logrados. Cada producto que queda en “Resuelto / ganado” llega aquí solo, con un renglón por servicio."
      />

      {error ? (
        <Card className="p-6 text-sm">
          <p className="font-medium text-red-700">No se pudo leer la cobranza.</p>
          <p className="mt-1 text-muted">
            Corre la migración <code className="rounded bg-stone-100 px-1">supabase/migrations/0007_cobranza.sql</code> en el SQL Editor de Supabase.
          </p>
          <p className="mt-2 text-xs text-muted">{error.message}</p>
        </Card>
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Por cobrar" value={mxn(porCobrar)} hint={`${all.filter((c) => OPEN.includes(c.status)).length} servicios abiertos`} />
            <Stat label="Vencido" value={mxn(vencido)} hint={`${vencidos.length} pasaron su fecha límite`} tone={vencidos.length ? "text-red-700" : undefined} />
            <Stat label="Cobrado" value={mxn(cobrado)} hint={`${all.filter((c) => c.status === "pagado").length} comisiones pagadas`} tone="text-emerald-700" />
            <Stat
              label="Servicios logrados"
              value={String(active.length)}
              hint={sinComision ? `${sinComision} sin comisión definida` : `${new Set(active.map((c) => c.lead_id)).size} clientes`}
            />
          </div>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-1.5 overflow-x-auto">
              {tabs.map((t) => (
                <Link
                  key={t.key}
                  href={href(t.key)}
                  className={cn(
                    "whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium",
                    status === t.key ? "bg-brand-600 text-white" : "bg-stone-100 text-muted hover:bg-stone-200",
                  )}
                >
                  {t.label} <span className="opacity-70">{count(t.key)}</span>
                </Link>
              ))}
            </div>
            <form className="flex flex-wrap gap-2">
              <input type="hidden" name="status" value={status} />
              <Input name="q" defaultValue={q} placeholder="Buscar cliente, folio, teléfono, servicio…" className="h-9 w-64" />
              <Select name="asesor" defaultValue={asesor} className="h-9 w-44">
                <option value="">Todos los asesores</option>
                {advisors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
              <button className="h-9 rounded-lg bg-brand-600 px-3 text-xs font-medium text-white hover:bg-brand-700">Filtrar</button>
            </form>
          </div>

          <Card>
            {groups.size === 0 ? (
              <EmptyState
                icon={<HandCoins className="size-10" />}
                title="Nada por cobrar en esta vista"
                description="Cuando un producto de un prospecto quede en “Resuelto / ganado”, aparecerá aquí para cobrar su comisión."
              />
            ) : (
              <CobranzaTable groups={[...groups.values()]} advisors={advisors} today={today} />
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <Card className="px-5 py-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums tracking-tight", tone ?? "text-ink")}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </Card>
  );
}
