"use client";

import { useState, useTransition } from "react";
import { Check, ExternalLink, Landmark, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { recheckPaymentWithBanxico, reviewDocument, updateLeadStatus } from "@/app/(crm)/actions";
import { LEAD_STATUSES, DOC_TYPES } from "@/lib/constants";
import { Button, Select } from "./ui";
import { DocStatusBadge } from "./status-badge";
import { formatDateTime } from "@/lib/utils";
import type { DocumentRow, DocumentStatus, LeadStatus } from "@/lib/types";

export function StatusSelect({ leadId, status }: { leadId: string; status: LeadStatus }) {
  const [value, setValue] = useState(status);
  const [pending, start] = useTransition();
  return (
    <Select
      value={value}
      disabled={pending}
      onChange={(e) => {
        const s = e.target.value as LeadStatus;
        setValue(s);
        start(() => updateLeadStatus(leadId, s));
      }}
    >
      {LEAD_STATUSES.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </Select>
  );
}

const BANXICO: Record<string, { label: string; tone: string }> = {
  confirmado: { label: "Confirmado en Banxico", tone: "bg-emerald-50 text-emerald-700" },
  no_coincide: { label: "Banxico: no coincide", tone: "bg-red-50 text-red-700" },
  no_encontrado: { label: "No aparece en Banxico", tone: "bg-amber-50 text-amber-800" },
  no_verificado: { label: "Sin verificar en Banxico", tone: "bg-stone-100 text-stone-600" },
};

const FIELD_LABELS: Record<string, string> = {
  nombre_completo: "Nombre",
  curp: "CURP",
  nss: "NSS",
  rfc: "RFC",
  clave_elector: "Clave de elector",
  fecha_nacimiento: "Nacimiento",
  sexo: "Sexo",
  domicilio: "Domicilio",
  codigo_postal: "C.P.",
  fecha_emision: "Emisión",
  vigencia: "Vigencia",
};

export function DocumentCard({ doc, showLead }: { doc: DocumentRow & { lead_name?: string }; showLead?: boolean }) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const ex = doc.extracted as Record<string, unknown>;

  async function openFile() {
    const { data } = await createClient().storage.from("media").createSignedUrl(doc.storage_path, 600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  const fields = Object.entries(FIELD_LABELS).filter(([k]) => ex[k]);
  const others = (ex.otros_datos as { campo: string; valor: string }[] | undefined) ?? [];
  const isReceipt = doc.doc_type === "comprobante_pago";
  const banxico = ex.banxico as { estado: string; detalle: string; consultado_en: string } | undefined;
  const [bxMsg, setBxMsg] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const reviewed = Boolean(doc.reviewed_at);

  const review = (status: DocumentStatus, notes?: string) =>
    start(async () => {
      setReviewError(null);
      const r = await reviewDocument(doc.id, status, notes);
      if (r.error) setReviewError(r.error);
    });

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{DOC_TYPES[doc.doc_type ?? "otro"] ?? doc.doc_type ?? "Documento"}</p>
          <p className="text-xs text-muted">
            {showLead && doc.lead_name ? `${doc.lead_name} · ` : ""}
            {formatDateTime(doc.created_at)}
            {typeof doc.confidence === "number" && ` · confianza ${Math.round(Number(doc.confidence) * 100)}%`}
          </p>
        </div>
        <DocStatusBadge status={doc.status} />
      </div>

      {reviewed && (
        <p className={`mt-2 text-xs font-medium ${doc.status === "valido" ? "text-emerald-700" : "text-red-700"}`}>
          {doc.status === "valido" ? "Aprobado" : "Rechazado"} por asesor · {formatDateTime(doc.reviewed_at!)}
        </p>
      )}
      {reviewed && doc.issues.length > 0 && (
        <button type="button" onClick={() => setShowIssues((v) => !v)} className="mt-1 text-xs text-muted underline-offset-2 hover:underline">
          {showIssues ? "Ocultar" : "Ver"} observaciones del OCR ({doc.issues.length})
        </button>
      )}
      {doc.issues.length > 0 && (!reviewed || showIssues) && (
        <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-amber-800">
          {doc.issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}

      {open && (fields.length > 0 || others.length > 0) && (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-stone-50 p-2 text-xs">
          {fields.map(([k, label]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{label}</dt>
              <dd className="break-words font-medium text-ink">{String(ex[k])}</dd>
            </div>
          ))}
          {others.map((o) => (
            <div key={o.campo} className="contents">
              <dt className="text-muted">{o.campo}</dt>
              <dd className="break-words text-ink">{o.valor}</dd>
            </div>
          ))}
        </dl>
      )}
      {doc.review_notes && <p className="mt-2 text-xs text-muted">Nota del asesor: {doc.review_notes}</p>}
      {isReceipt && banxico && BANXICO[banxico.estado] && (
        <p className={`mt-2 rounded-md px-2 py-1 text-xs ${BANXICO[banxico.estado]!.tone}`} title={banxico.detalle}>
          <Landmark className="mr-1 inline size-3.5" />
          {BANXICO[banxico.estado]!.label} · {formatDateTime(banxico.consultado_en)}
        </p>
      )}
      {bxMsg && <p className="mt-1 text-xs text-muted">{bxMsg}</p>}

      {reviewError && <p className="mt-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">No se guardó la revisión: {reviewError}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="secondary" onClick={openFile}>
          <ExternalLink className="size-3.5" /> Ver
        </Button>
        {fields.length + others.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
            {open ? "Ocultar datos" : "Datos OCR"}
          </Button>
        )}
        {isReceipt && (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            title="Consultar el CEP en banxico.org.mx/cep"
            onClick={() =>
              start(async () => {
                const r = await recheckPaymentWithBanxico(doc.id);
                setBxMsg(r.error ?? `${r.estado}: ${r.detalle}`);
              })
            }
          >
            <Landmark className="size-3.5" /> {pending ? "Consultando…" : "Verificar en Banxico"}
          </Button>
        )}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => review("valido")} title="Aprobar">
          <Check className="size-3.5 text-emerald-600" /> Aprobar
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            const notes = window.prompt("Motivo del rechazo (opcional)") ?? undefined;
            review("invalido", notes);
          }}
          title="Rechazar"
        >
          <X className="size-3.5 text-red-600" /> Rechazar
        </Button>
      </div>
    </div>
  );
}
