"use client";

import { useState, useTransition } from "react";
import { FolderUp, UserRound } from "lucide-react";
import { sendExpedienteToAdvisor, setTramiteAdvisor } from "@/app/(crm)/actions";
import { formatDateTime } from "@/lib/utils";
import { Button, Select } from "./ui";

type Advisor = { id: string; name: string };

/**
 * Asesor de un trámite y envío de su expediente (ZIP + resumen) a su WhatsApp.
 * Sin asesor propio se usa el principal del prospecto.
 */
export function TramiteAdvisorPanel({
  tramiteId,
  leadId,
  advisors,
  assignedTo,
  leadAdvisorId,
  canSend,
  lastSentAt,
}: {
  tramiteId: string;
  leadId: string;
  advisors: Advisor[];
  assignedTo: string | null;
  leadAdvisorId: string | null;
  canSend: boolean;
  lastSentAt: string | null;
}) {
  const [value, setValue] = useState(assignedTo ?? "");
  const [saving, startSaving] = useTransition();
  const [sending, startSending] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof sendExpedienteToAdvisor>> | null>(null);

  const leadAdvisor = advisors.find((a) => a.id === leadAdvisorId);
  const effective = advisors.find((a) => a.id === (value || leadAdvisorId));

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2">
        <UserRound className="size-4 shrink-0 text-muted" aria-hidden />
        <span className="sr-only">Asesor del trámite</span>
        <Select
          value={value}
          disabled={saving}
          className="h-9"
          onChange={(e) => {
            const next = e.target.value;
            const prev = value;
            setValue(next);
            setSaveError(null);
            startSaving(async () => {
              const r = await setTramiteAdvisor(tramiteId, leadId, next || null);
              if (r.error) {
                setValue(prev);
                setSaveError(r.error);
              }
            });
          }}
        >
          <option value="">{leadAdvisor ? `Asesor principal (${leadAdvisor.name})` : "Sin asesor"}</option>
          {advisors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </label>
      {saveError && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700 ring-1 ring-red-600/20">{saveError}</p>}

      {canSend && (
        <>
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            disabled={sending || saving || !effective}
            onClick={() => startSending(async () => setResult(await sendExpedienteToAdvisor(tramiteId)))}
          >
            <FolderUp className="size-4" />
            {sending ? "Armando expediente…" : effective ? `${lastSentAt ? "Reenviar" : "Enviar"} expediente a ${effective.name}` : "Elige un asesor para enviar el expediente"}
          </Button>

          {!result && lastSentAt && <p className="text-xs text-muted">Enviado al asesor el {formatDateTime(lastSentAt)}. Cuando responda, actualiza la fase arriba.</p>}
          {result?.error && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700 ring-1 ring-red-600/20">{result.error}</p>}
          {result?.sentTo && (
            <p className="rounded-lg bg-emerald-50 p-2 text-xs text-emerald-800 ring-1 ring-emerald-600/20">
              Expediente con {result.docCount} documento{result.docCount === 1 ? "" : "s"} enviado a {result.sentTo}. Cuando responda, actualiza la fase arriba.
              {result.failed?.length ? ` No se pudieron incluir: ${result.failed.join(", ")}.` : ""}
            </p>
          )}
          {result?.url && (
            <a href={result.url} target="_blank" rel="noreferrer" className="block text-center text-xs font-medium text-brand-600 hover:underline">
              Descargar el ZIP
            </a>
          )}
        </>
      )}
    </div>
  );
}
