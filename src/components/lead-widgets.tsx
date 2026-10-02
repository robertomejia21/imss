"use client";

import { useState, useTransition } from "react";
import { Check, ExternalLink, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { reviewDocument, updateLeadStatus } from "@/app/(crm)/actions";
import { LEAD_STATUSES, DOC_TYPES } from "@/lib/constants";
import { Button, Select } from "./ui";
import { DocStatusBadge } from "./status-badge";
import { formatDateTime } from "@/lib/utils";
import type { DocumentRow, LeadStatus } from "@/lib/types";

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

      {doc.issues.length > 0 && (
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

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="secondary" onClick={openFile}>
          <ExternalLink className="size-3.5" /> Ver
        </Button>
        {fields.length + others.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
            {open ? "Ocultar datos" : "Datos OCR"}
          </Button>
        )}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(() => reviewDocument(doc.id, "valido"))} title="Aprobar">
          <Check className="size-3.5 text-emerald-600" /> Aprobar
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            const notes = window.prompt("Motivo del rechazo (opcional)") ?? undefined;
            start(() => reviewDocument(doc.id, "invalido", notes));
          }}
          title="Rechazar"
        >
          <X className="size-3.5 text-red-600" /> Rechazar
        </Button>
      </div>
    </div>
  );
}
