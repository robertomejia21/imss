"use client";

import { useState, useTransition } from "react";
import { FileSignature } from "lucide-react";
import { sendDesempleoContract } from "@/app/(crm)/actions";
import { Button } from "./ui";

/** Genera el contrato de retiro por desempleo y lo envía al WhatsApp del asesor asignado. */
export function ContractButton({ leadId }: { leadId: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Awaited<ReturnType<typeof sendDesempleoContract>> | null>(null);

  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        size="sm"
        className="w-full"
        disabled={pending}
        onClick={() => start(async () => setResult(await sendDesempleoContract(leadId)))}
      >
        <FileSignature className="size-4" />
        {pending ? "Generando contrato…" : "Enviar contrato de retiro por desempleo al asesor"}
      </Button>

      {result?.missing && (
        <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-600/20">
          <p className="font-medium">Faltan estos datos para el contrato:</p>
          <ul className="mt-1 list-disc pl-4">
            {result.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <p className="mt-1 text-amber-800">
            Pídeselos al cliente o captúralos en “Datos del prospecto”. El domicilio y la clave de elector se llenan solos al recibir la INE. El asesor y su WhatsApp se registran en el menú Asesores.
          </p>
        </div>
      )}
      {result?.error && <p className="rounded-lg bg-red-50 p-3 text-xs text-red-700 ring-1 ring-red-600/20">{result.error}</p>}
      {result?.sentTo && <p className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800 ring-1 ring-emerald-600/20">Contrato enviado por WhatsApp a {result.sentTo}.</p>}
      {result?.url && (
        <a href={result.url} target="_blank" rel="noreferrer" className="block text-center text-xs font-medium text-brand-600 hover:underline">
          Ver / descargar el PDF
        </a>
      )}
    </div>
  );
}
