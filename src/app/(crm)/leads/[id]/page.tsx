import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { addNote, createTramite, updateLead, updateTramite } from "../../actions";
import { ChatPanel } from "@/components/chat-panel";
import { DocumentCard, StatusSelect } from "@/components/lead-widgets";
import { TramiteStatusBadge } from "@/components/status-badge";
import { Button, Card, CardHeader, EmptyState, Field, Input, Select, Textarea } from "@/components/ui";
import { TRAMITE_STATUSES, TRAMITE_TYPES } from "@/lib/constants";
import { displayName, formatDate, formatDateTime, isValidCurp, isValidNss } from "@/lib/utils";
import type { Activity, DocumentRow, Lead, Message, Profile, Tramite } from "@/lib/types";

export default async function LeadPage({ params }: PageProps<"/leads/[id]">) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: lead }, { data: messages }, { data: docs }, { data: tramites }, { data: activities }, { data: profiles }] =
    await Promise.all([
      supabase.from("leads").select("*").eq("id", id).maybeSingle(),
      supabase.from("messages").select("*").eq("lead_id", id).order("created_at").limit(300),
      supabase.from("documents").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
      supabase.from("tramites").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
      supabase.from("activities").select("*").eq("lead_id", id).order("created_at", { ascending: false }).limit(50),
      supabase.from("profiles").select("id, full_name, email, role"),
    ]);
  if (!lead) notFound();
  const l = lead as Lead;
  const curpOk = !l.curp || isValidCurp(l.curp);
  const nssOk = !l.nss || isValidNss(l.nss);

  const extra = { ...l.form_data, ...l.captured_data } as Record<string, unknown>;
  const utmEntries = Object.entries(l.utm ?? {});

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-8">
      <Link href="/leads" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Prospectos
      </Link>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{displayName(l)}</h1>
          <p className="mt-1 text-sm text-muted">
            Folio {l.folio} · Alta {formatDate(l.created_at)} · Origen: <span className="capitalize">{l.source}</span>
          </p>
        </div>
        <div className="w-56">
          <StatusSelect leadId={l.id} status={l.status} />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[22rem_1fr_24rem]">
        {/* Datos */}
        <div className="space-y-6">
          <Card>
            <CardHeader title="Datos del prospecto" />
            <form action={updateLead.bind(null, l.id)} className="space-y-3 p-5">
              <Field label="Nombre completo">
                <Input name="full_name" defaultValue={l.full_name ?? ""} />
              </Field>
              <Field label="CURP" hint={curpOk ? undefined : "⚠ CURP con formato inválido"}>
                <Input name="curp" defaultValue={l.curp ?? ""} className="font-mono uppercase" maxLength={18} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="NSS" hint={nssOk ? undefined : "⚠ NSS inválido"}>
                  <Input name="nss" defaultValue={l.nss ?? ""} className="font-mono" maxLength={11} />
                </Field>
                <Field label="RFC">
                  <Input name="rfc" defaultValue={l.rfc ?? ""} className="font-mono uppercase" maxLength={13} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Nacimiento">
                  <Input name="birth_date" type="date" defaultValue={l.birth_date ?? ""} />
                </Field>
                <Field label="Correo">
                  <Input name="email" type="email" defaultValue={l.email ?? ""} />
                </Field>
              </div>
              <Field label="Trámite">
                <Select name="tramite_type" defaultValue={l.tramite_type ?? ""}>
                  <option value="">Sin definir</option>
                  {[...new Set([...(l.tramite_type ? [l.tramite_type] : []), ...TRAMITE_TYPES])].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Asesor asignado">
                <Select name="assigned_to" defaultValue={l.assigned_to ?? ""}>
                  <option value="">Sin asignar</option>
                  {(profiles as Profile[] | null)?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name ?? p.email}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Notas internas">
                <Textarea name="notes" rows={3} defaultValue={l.notes ?? ""} />
              </Field>
              <Button className="w-full">Guardar cambios</Button>
            </form>
          </Card>

          {(Object.keys(extra).length > 0 || utmEntries.length > 0) && (
            <Card>
              <CardHeader title="Información capturada" />
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 p-5 text-sm">
                {Object.entries(extra).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted">{k.replaceAll("_", " ")}</dt>
                    <dd className="break-words text-ink">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
                  </div>
                ))}
                {utmEntries.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted">{k}</dt>
                    <dd className="break-all text-xs text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}
        </div>

        {/* Chat */}
        <Card className="h-[75vh] min-h-[520px] overflow-hidden xl:sticky xl:top-6">
          <ChatPanel
            key={l.id}
            lead={l}
            initialMessages={(messages ?? []) as Message[]}
            initialDocs={(docs ?? []) as DocumentRow[]}
            showLeadLink={false}
          />
        </Card>

        {/* Trámites, documentos, bitácora */}
        <div className="space-y-6">
          <Card>
            <CardHeader title="Trámites" />
            <div className="space-y-3 p-4">
              {(tramites as Tramite[] | null)?.map((t) => (
                <details key={t.id} className="group rounded-lg border border-line">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3">
                    <div>
                      <p className="text-sm font-medium">{t.tipo}</p>
                      <p className="text-xs text-muted">
                        {t.folio_imss ? `Folio IMSS ${t.folio_imss} · ` : ""}
                        {t.due_date ? `Compromiso ${formatDate(t.due_date)}` : `Actualizado ${formatDate(t.updated_at)}`}
                      </p>
                    </div>
                    <TramiteStatusBadge status={t.status} />
                  </summary>
                  <form action={updateTramite.bind(null, t.id, l.id)} className="space-y-2 border-t border-line p-3">
                    <Select name="status" defaultValue={t.status}>
                      {Object.entries(TRAMITE_STATUSES).map(([v, m]) => (
                        <option key={v} value={v}>
                          {m.label}
                        </option>
                      ))}
                    </Select>
                    <div className="grid grid-cols-2 gap-2">
                      <Input name="folio_imss" placeholder="Folio IMSS" defaultValue={t.folio_imss ?? ""} />
                      <Input name="due_date" type="date" defaultValue={t.due_date ?? ""} />
                    </div>
                    <Textarea name="notes" rows={2} placeholder="Notas" defaultValue={t.notes ?? ""} />
                    <Button size="sm" className="w-full">
                      Actualizar trámite
                    </Button>
                  </form>
                </details>
              ))}
              <details className="rounded-lg border border-dashed border-line">
                <summary className="flex cursor-pointer list-none items-center gap-2 p-3 text-sm font-medium text-brand-600">
                  <Plus className="size-4" /> Nuevo trámite
                </summary>
                <form action={createTramite.bind(null, l.id)} className="space-y-2 border-t border-line p-3">
                  <Select name="tipo" defaultValue={l.tramite_type ?? TRAMITE_TYPES[0]}>
                    {[...new Set([...(l.tramite_type ? [l.tramite_type] : []), ...TRAMITE_TYPES])].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </Select>
                  <div className="grid grid-cols-2 gap-2">
                    <Input name="folio_imss" placeholder="Folio IMSS" />
                    <Input name="due_date" type="date" />
                  </div>
                  <Textarea name="notes" rows={2} placeholder="Notas" />
                  <Button size="sm" className="w-full">
                    Crear trámite
                  </Button>
                </form>
              </details>
            </div>
          </Card>

          <Card>
            <CardHeader title={`Documentos (${docs?.length ?? 0})`} />
            <div className="space-y-3 p-4">
              {!docs?.length && <EmptyState icon={<FileText className="size-8" />} title="Sin documentos" description="Las fotos o PDFs que envíe por WhatsApp se verifican aquí con OCR." />}
              {(docs as DocumentRow[] | null)?.map((d) => (
                <DocumentCard key={d.id} doc={d} />
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Bitácora" />
            <form action={addNote.bind(null, l.id)} className="flex gap-2 border-b border-line p-4">
              <Input name="content" placeholder="Agregar nota…" />
              <Button variant="secondary">Agregar</Button>
            </form>
            <ol className="max-h-96 space-y-3 overflow-y-auto p-4 scrollbar-thin">
              {(activities as Activity[] | null)?.map((a) => (
                <li key={a.id} className="flex gap-3 text-sm">
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${a.kind === "note" ? "bg-brand-500" : a.kind === "ai" ? "bg-indigo-400" : "bg-stone-300"}`} />
                  <div>
                    <p className="text-ink">{a.content}</p>
                    <p className="text-xs text-muted">{formatDateTime(a.created_at)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
