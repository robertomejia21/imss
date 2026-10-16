"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteLead } from "@/app/(crm)/actions";
import { Button, Input } from "./ui";

/** Elimina un prospecto (para reiniciar su trámite en pruebas). Pide contraseña antes de borrar. */
export function DeleteLeadButton({ leadId, name }: { leadId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const close = () => {
    setOpen(false);
    setPassword("");
    setError(null);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg p-2 text-stone-400 hover:bg-red-50 hover:text-red-600"
        title="Eliminar prospecto"
        aria-label={`Eliminar a ${name}`}
      >
        <Trash2 className="size-4" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
          <form
            className="w-full max-w-sm space-y-3 rounded-xl border border-line bg-paper p-5 text-left shadow-card"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const res = await deleteLead(leadId, password);
                if (res.error) setError(res.error);
                else close();
              });
            }}
          >
            <h2 className="text-base font-semibold text-ink">Eliminar a {name}</h2>
            <p className="text-sm text-muted">
              Se borran sus mensajes, documentos, trámites y archivos. Si vuelve a escribir, empezará su trámite desde cero. No se puede deshacer.
            </p>
            <Input type="password" autoFocus placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={close}>
                Cancelar
              </Button>
              <Button variant="danger" disabled={pending || !password}>
                {pending ? "Eliminando…" : "Eliminar"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
