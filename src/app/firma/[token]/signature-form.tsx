"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CheckCircle2, Eraser, Loader2 } from "lucide-react";
import { signAuthorization } from "../actions";
import { Button } from "@/components/ui";

/** Recuadro para firmar con el dedo o el mouse, y envío de la firma. */
export function SignatureForm({ token }: { token: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  // Lienzo nítido según la densidad de pantalla
  useEffect(() => {
    const c = canvas.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0d2673";
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function clear() {
    const c = canvas.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  }

  if (done) {
    return (
      <div className="rounded-xl bg-emerald-50 p-6 text-center">
        <CheckCircle2 className="mx-auto size-10 text-emerald-600" />
        <p className="mt-3 font-semibold text-emerald-900">¡Listo! Tu formato quedó firmado.</p>
        <p className="mt-1 text-sm text-emerald-800">Te enviamos una copia por WhatsApp. Ya puedes regresar a la conversación.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-sm font-medium text-ink">Firma aquí con tu dedo</p>
          <button type="button" onClick={clear} className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
            <Eraser className="size-3.5" /> Borrar
          </button>
        </div>
        <canvas
          ref={canvas}
          className="h-44 w-full touch-none rounded-xl border-2 border-dashed border-line bg-white"
          onPointerDown={(e) => {
            drawing.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            const ctx = e.currentTarget.getContext("2d")!;
            const { x, y } = point(e);
            ctx.beginPath();
            ctx.moveTo(x, y);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const ctx = e.currentTarget.getContext("2d")!;
            const { x, y } = point(e);
            ctx.lineTo(x, y);
            ctx.stroke();
            setHasInk(true);
          }}
          onPointerUp={() => (drawing.current = false)}
          onPointerCancel={() => (drawing.current = false)}
        />
      </div>

      <label className="flex items-start gap-2 text-sm text-stone-700">
        <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-brand-600" />
        <span>
          Leí el formato, mis datos son correctos y autorizo la consulta y reserva en la plataforma Nomi-Pay. Acepto que esta firma trazada en
          pantalla vale como mi firma en este formato.
        </span>
      </label>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <Button
        className="h-12 w-full text-base"
        disabled={pending || !hasInk || !accepted}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await signAuthorization(token, canvas.current!.toDataURL("image/png"), accepted);
            if (r.error) setError(r.error);
            else setDone(true);
          })
        }
      >
        {pending ? <Loader2 className="size-5 animate-spin" /> : "Firmar y enviar"}
      </Button>
    </div>
  );
}
