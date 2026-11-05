"use client";

import Link from "next/link";
import { Fragment, useState, useTransition } from "react";
import { CheckCircle2, Download, Pencil, X } from "lucide-react";
import { markCobroPaid, updateCobro } from "@/app/(crm)/actions";
import { Badge, Button, Field, Input, Select, Textarea } from "./ui";
import { COBRO_STATUSES, PAYMENT_METHODS, cobroSaldo as saldo, isCobroOverdue as isOverdue, mxn } from "@/lib/constants";
import { cn, formatDate, formatPhone } from "@/lib/utils";
import type { Cobro, Lead } from "@/lib/types";

export type CobroLead = Pick<Lead, "id" | "folio" | "full_name" | "wa_name" | "phone" | "curp" | "nss" | "email">;
export type CobroGroup = { lead: CobroLead; cobros: Cobro[] };

const leadName = (l: CobroLead) => l.full_name || l.wa_name || formatPhone(l.phone) || l.folio;

/** Tabla de cobranza: un renglón por servicio logrado, agrupado por cliente. */
export function CobranzaTable({
  groups,
  advisors,
  today,
}: {
  groups: CobroGroup[];
  advisors: { id: string; name: string }[];
  today: string;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const advisorName = (id: string | null) => advisors.find((a) => a.id === id)?.name ?? "—";

  function exportCsv() {
    const head = ["Folio", "Cliente", "Teléfono", "CURP", "NSS", "Servicio", "Asesor", "Fecha servicio", "Monto servicio", "Comisión", "Cobrado", "Saldo", "Estado", "Fecha límite", "Fecha pago", "Método", "Referencia", "Notas"];
    const rows = groups.flatMap(({ lead, cobros }) =>
      cobros.map((c) => [
        lead.folio, leadName(lead), lead.phone ?? "", lead.curp ?? "", lead.nss ?? "", c.servicio, advisorName(c.asesor_id),
        c.fecha_servicio, c.monto_servicio ?? "", c.comision, c.monto_cobrado, saldo(c),
        isOverdue(c, today) ? "Vencido" : COBRO_STATUSES[c.status].label, c.fecha_limite ?? "", c.fecha_pago ?? "",
        c.metodo_pago ?? "", c.referencia ?? "", c.notas ?? "",
      ]),
    );
    const csv = [head, ...rows].map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `cobranza-${today}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="flex justify-end border-b border-line px-4 py-2">
        <Button variant="ghost" size="sm" onClick={exportCsv}>
          <Download className="size-3.5" /> Exportar CSV
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="bg-stone-50 text-left text-xs font-medium uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2.5">Cliente</th>
              <th className="px-3 py-2.5">Servicio adquirido</th>
              <th className="px-3 py-2.5">Asesor</th>
              <th className="px-3 py-2.5 text-right">Monto servicio</th>
              <th className="px-3 py-2.5 text-right">Comisión</th>
              <th className="px-3 py-2.5 text-right">Cobrado</th>
              <th className="px-3 py-2.5 text-right">Saldo</th>
              <th className="px-3 py-2.5">Fecha límite</th>
              <th className="px-3 py-2.5">Estado</th>
              <th className="px-3 py-2.5">Pago</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {groups.map(({ lead, cobros }) => {
              const leadSaldo = cobros.reduce((s, c) => s + saldo(c), 0);
              return cobros.map((c, i) => {
                const overdue = isOverdue(c, today);
                const meta = COBRO_STATUSES[c.status];
                return (
                  <Fragment key={c.id}>
                    <tr className={cn("align-top", i === 0 && "border-t border-line", editing === c.id && "bg-brand-50/40")}>
                      {i === 0 && (
                        <td rowSpan={cobros.length + (cobros.some((x) => x.id === editing) ? 1 : 0)} className="border-r border-line px-4 py-3">
                          <Link href={`/leads/${lead.id}`} className="font-medium text-brand-700 hover:underline">
                            {leadName(lead)}
                          </Link>
                          <p className="mt-0.5 text-xs text-muted">
                            {lead.folio}
                            {lead.phone ? ` · ${formatPhone(lead.phone)}` : ""}
                          </p>
                          {lead.curp && <p className="text-xs text-muted">CURP {lead.curp}</p>}
                          {lead.nss && <p className="text-xs text-muted">NSS {lead.nss}</p>}
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {cobros.length > 1 && <Badge>{cobros.length} servicios</Badge>}
                            {leadSaldo > 0 && <Badge className="bg-amber-50 text-amber-800 ring-amber-600/20">Debe {mxn(leadSaldo)}</Badge>}
                          </div>
                        </td>
                      )}
                      <td className="px-3 py-3">
                        <p className="font-medium">{c.servicio}</p>
                        <p className="text-xs text-muted">Logrado {formatDate(c.fecha_servicio)}</p>
                      </td>
                      <td className="px-3 py-3 text-muted">{advisorName(c.asesor_id)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{mxn(c.monto_servicio)}</td>
                      <td className="px-3 py-3 text-right font-medium tabular-nums">
                        {Number(c.comision) > 0 ? mxn(Number(c.comision)) : <span className="text-amber-700">Sin definir</span>}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{mxn(Number(c.monto_cobrado))}</td>
                      <td className={cn("px-3 py-3 text-right font-medium tabular-nums", saldo(c) > 0 ? "text-ink" : "text-muted")}>{mxn(saldo(c))}</td>
                      <td className={cn("px-3 py-3 whitespace-nowrap", overdue ? "font-medium text-red-700" : "text-muted")}>
                        {c.fecha_limite ? formatDate(c.fecha_limite) : "—"}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col items-start gap-1">
                          <Badge className={meta.tone}>{meta.label}</Badge>
                          {overdue && <Badge className="bg-red-50 text-red-700 ring-red-600/20">Vencido</Badge>}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs text-muted">
                        {c.fecha_pago ? <p>{formatDate(c.fecha_pago)}</p> : "—"}
                        {c.metodo_pago && <p>{c.metodo_pago}</p>}
                        {c.referencia && <p className="max-w-32 truncate" title={c.referencia}>Ref. {c.referencia}</p>}
                        {c.notas && <p className="max-w-40 truncate italic" title={c.notas}>{c.notas}</p>}
                      </td>
                      <td className="px-3 py-3">
                        <RowActions cobro={c} editing={editing === c.id} onEdit={() => setEditing(editing === c.id ? null : c.id)} />
                      </td>
                    </tr>
                    {editing === c.id && (
                      <tr className="bg-brand-50/40">
                        <td colSpan={10} className="px-3 pb-4">
                          <CobroForm cobro={c} advisors={advisors} onDone={() => setEditing(null)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              });
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowActions({ cobro, editing, onEdit }: { cobro: Cobro; editing: boolean; onEdit: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const canPay = cobro.status !== "pagado" && cobro.status !== "cancelado" && Number(cobro.comision) > 0;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        {canPay && (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            title="Registrar el pago completo con fecha de hoy"
            onClick={() => start(async () => setError((await markCobroPaid(cobro.id)).error ?? null))}
          >
            <CheckCircle2 className="size-3.5 text-emerald-600" /> Pagado
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onEdit} title={editing ? "Cerrar" : "Editar cobro"}>
          {editing ? <X className="size-3.5" /> : <Pencil className="size-3.5" />}
        </Button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function CobroForm({ cobro: c, advisors, onDone }: { cobro: Cobro; advisors: { id: string; name: string }[]; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      action={(fd) =>
        start(async () => {
          const r = await updateCobro(c.id, fd);
          if (r.error) setError(r.error);
          else onDone();
        })
      }
      className="grid gap-3 rounded-lg border border-line bg-paper p-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <Field label="Estado">
        <Select name="status" defaultValue={c.status}>
          {Object.entries(COBRO_STATUSES).map(([v, m]) => (
            <option key={v} value={v}>
              {m.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Comisión a cobrar ($)">
        <Input name="comision" inputMode="decimal" defaultValue={Number(c.comision) || ""} placeholder="0" />
      </Field>
      <Field label="Cobrado / abonos ($)" hint="Si cubre la comisión, queda como pagado.">
        <Input name="monto_cobrado" inputMode="decimal" defaultValue={Number(c.monto_cobrado) || ""} placeholder="0" />
      </Field>
      <Field label="Monto del servicio ($)">
        <Input name="monto_servicio" inputMode="decimal" defaultValue={c.monto_servicio ?? ""} placeholder="Opcional" />
      </Field>
      <Field label="Asesor">
        <Select name="asesor_id" defaultValue={c.asesor_id ?? ""}>
          <option value="">Sin asignar</option>
          {advisors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Fecha límite de pago">
        <Input name="fecha_limite" type="date" defaultValue={c.fecha_limite ?? ""} />
      </Field>
      <Field label="Fecha de pago">
        <Input name="fecha_pago" type="date" defaultValue={c.fecha_pago ?? ""} />
      </Field>
      <Field label="Método de pago">
        <Select name="metodo_pago" defaultValue={c.metodo_pago ?? ""}>
          <option value="">—</option>
          {PAYMENT_METHODS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </Select>
      </Field>
      <Field label="Referencia / folio de pago">
        <Input name="referencia" defaultValue={c.referencia ?? ""} placeholder="Clave de rastreo, recibo…" />
      </Field>
      <div className="sm:col-span-2 lg:col-span-3">
        <Field label="Notas">
          <Textarea name="notas" rows={2} defaultValue={c.notas ?? ""} placeholder="Acuerdos de pago, seguimiento…" />
        </Field>
      </div>
      <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-4">
        <Button size="sm" disabled={pending}>
          {pending ? "Guardando…" : "Guardar cobro"}
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </form>
  );
}
