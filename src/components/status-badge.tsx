import { Badge } from "./ui";
import { DOCUMENT_STATUSES, TRAMITE_STATUSES, leadStatusMeta } from "@/lib/constants";
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
