"use client";

import { useState, useTransition } from "react";
import { FolderUp } from "lucide-react";
import { sendExpedienteToAdvisor } from "@/app/(crm)/actions";
import { formatDateTime } from "@/lib/utils";
import { Button } from "./ui";

/** Envía el expediente del trámite (ZIP + resumen) al WhatsApp del asesor asignado. */
export function ExpedienteButton({ tramiteId, advisorName, lastSentAt }: { tramiteId: string; advisorName: string | null; lastSentAt: string | null }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Awaited<ReturnType<typeof sendExpedienteToAdvisor>> | null>(null);

  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        size="sm"
        className="w-full"
        disabled={pending || !advisorName}
        title={advisorName ? undefined : "Asigna un asesor en “Datos del prospecto”"}
        onClick={() => start(async () => setResult(await sendExpedienteToAdvisor(tramiteId)))}
      >
        <FolderUp className="size-4" />
        {pending ? "Armando expediente…" : advisorName ? `${lastSentAt ? "Reenviar" : "Enviar"} expediente a ${advisorName}` : "Sin asesor asignado"}
      </Button>

      {!result && lastSentAt && <p className="text-xs text-muted">Enviado al asesor el {formatDateTime(lastSentAt)}. Cuando responda, actualiza la fase abajo.</p>}
      {result?.error && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700 ring-1 ring-red-600/20">{result.error}</p>}
      {result?.sentTo && (
        <p className="rounded-lg bg-emerald-50 p-2 text-xs text-emerald-800 ring-1 ring-emerald-600/20">
          Expediente con {result.docCount} documento{result.docCount === 1 ? "" : "s"} enviado a {result.sentTo}. Cuando responda, actualiza la fase abajo.
          {result.failed?.length ? ` No se pudieron incluir: ${result.failed.join(", ")}.` : ""}
        </p>
      )}
      {result?.url && (
        <a href={result.url} target="_blank" rel="noreferrer" className="block text-center text-xs font-medium text-brand-600 hover:underline">
          Descargar el ZIP
        </a>
      )}
    </div>
  );
}
