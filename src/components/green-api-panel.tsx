"use client";

import { useEffect, useState, useTransition } from "react";
import { CheckCircle2, CircleAlert, Loader2, RefreshCw } from "lucide-react";
import { checkGreenApi, configureGreenWebhook } from "@/app/(crm)/actions";
import { Button, Field, Input } from "./ui";

const STATE_LABEL: Record<string, string> = {
  authorized: "Conectado",
  notAuthorized: "Sin vincular (escanea el QR en Green API)",
  blocked: "Bloqueado",
  sleepMode: "En reposo",
  starting: "Iniciando",
  yellowCard: "Advertencia de WhatsApp",
  no_configurado: "Faltan credenciales en .env",
  error: "Error de conexión",
};

export function GreenApiPanel({ defaultAppUrl }: { defaultAppUrl: string }) {
  const [state, setState] = useState<string | null>(null);
  const [appUrl, setAppUrl] = useState(defaultAppUrl);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const refresh = () => start(async () => setState((await checkGreenApi()).state));
  useEffect(refresh, []);

  const ok = state === "authorized";

  return (
    <div className="space-y-4 p-5">
      <div className="flex items-center gap-3">
        {state === null ? (
          <Loader2 className="size-5 animate-spin text-muted" />
        ) : ok ? (
          <CheckCircle2 className="size-5 text-emerald-600" />
        ) : (
          <CircleAlert className="size-5 text-amber-600" />
        )}
        <div className="flex-1">
          <p className="text-sm font-medium">Estado de la instancia</p>
          <p className="text-xs text-muted">{state ? (STATE_LABEL[state] ?? state) : "Consultando…"}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={refresh} disabled={pending} aria-label="Actualizar">
          <RefreshCw className="size-3.5" />
        </Button>
      </div>

      <Field label="URL pública de este CRM" hint="Debe ser HTTPS y accesible desde internet (en local usa ngrok o cloudflared).">
        <Input value={appUrl} onChange={(e) => setAppUrl(e.target.value)} placeholder="https://crm.tudominio.com" />
      </Field>
      <Button
        variant="secondary"
        disabled={pending || !appUrl.startsWith("https://")}
        onClick={() =>
          start(async () => {
            const r = await configureGreenWebhook(appUrl);
            setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: `Webhook configurado: ${r.url}` });
          })
        }
      >
        Configurar webhook en Green API
      </Button>
      {msg && <p className={`rounded-lg px-3 py-2 text-xs ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}
    </div>
  );
}
