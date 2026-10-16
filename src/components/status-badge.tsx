import { Badge } from "./ui";
import { DOCUMENT_STATUSES, TRAMITE_FLOW, TRAMITE_STATUSES, leadStatusMeta } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { DocumentStatus, LeadStatus, TramiteStatus } from "@/lib/types";

export const LeadStatusBadge = ({ status }: { status: LeadStatus }) => {
  const m = leadStatusMeta(status);
  return <Badge className={m.tone}>{m.label}</Badge>;
};

export const DocStatusBadge = ({ status }: { status: DocumentStatus }) => {
  const m = DOCUMENT_STATUSES[status];
  return <Badge className={m.tone}>{m.label}</Badge>;
};

export const TramiteStatusBadge = ({ status }: { status: TramiteStatus }) => {
  const m = TRAMITE_STATUSES[status];
  return <Badge className={m.tone}>{m.label}</Badge>;
};

/** Barra por fases de un producto: un segmento por paso del camino feliz + la fase actual. */
export const TramiteProgress = ({ status }: { status: TramiteStatus }) => {
  const step = TRAMITE_FLOW.indexOf(status);
  const closed = step === -1;
  const done = status === "resuelto";
  const fill = done ? "bg-emerald-500" : "bg-brand-600";
  const title = closed
    ? TRAMITE_STATUSES[status].label
    : `Paso ${step + 1} de ${TRAMITE_FLOW.length}: ${TRAMITE_FLOW.map((s) => TRAMITE_STATUSES[s].label).join(" → ")}`;
  return (
    <span className="inline-flex items-center gap-2" title={title}>
      <span className="flex gap-0.5">
        {TRAMITE_FLOW.map((s, i) => (
          <span key={s} className={cn("h-1.5 w-4 rounded-full", closed ? "bg-stone-200" : i <= step ? fill : "bg-stone-200")} />
        ))}
      </span>
      <span
        className={cn(
          "whitespace-nowrap text-xs",
          closed ? "text-red-600" : done ? "text-emerald-700" : "text-muted",
        )}
      >
        {TRAMITE_STATUSES[status].label}
      </span>
    </span>
  );
};
