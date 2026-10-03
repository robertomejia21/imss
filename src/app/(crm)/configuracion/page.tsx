import { createClient } from "@/lib/supabase/server";
import { saveAgentSettings } from "../actions";
import { GreenApiPanel } from "@/components/green-api-panel";
import { TeamPanel } from "@/components/team-panel";
import { Button, Card, CardHeader, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { DEFAULT_AGENT_PROMPT } from "@/lib/ai/prompt";
import type { AgentSettings, Profile } from "@/lib/types";

export const metadata = { title: "Configuración" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const [{ data }, { data: profiles }] = await Promise.all([
    supabase.from("agent_settings").select("*").eq("id", 1).single(),
    supabase.from("profiles").select("*").order("created_at"),
  ]);
  const s = data as AgentSettings | null;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const waNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "";

  const env = [
    ["Anthropic (IA + OCR)", Boolean(process.env.ANTHROPIC_API_KEY)],
    ["Green API", Boolean(process.env.GREEN_API_ID_INSTANCE && process.env.GREEN_API_TOKEN_INSTANCE)],
    ["Token del webhook", Boolean(process.env.GREEN_API_WEBHOOK_TOKEN)],
    ["Transcripción de audios", Boolean(process.env.OPENAI_API_KEY)],
    ["API de captación", Boolean(process.env.INTAKE_API_KEY)],
  ] as const;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
      <PageHeader title="Configuración" description="Asistente de IA, conexión con WhatsApp e integraciones." />

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
        <Card>
          <CardHeader title="Asistente de IA" />
          <form action={saveAgentSettings} className="space-y-4 p-5">
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" name="enabled" defaultChecked={s?.enabled ?? true} className="size-4 accent-brand-600" />
              <span>
                <b>Asistente activo</b>
                <span className="block text-xs text-muted">Si lo apagas, ningún mensaje recibe respuesta automática.</span>
              </span>
            </label>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Nombre del asistente">
                <Input name="agent_name" defaultValue={s?.agent_name ?? "Asistente"} />
              </Field>
              <Field label="Profundidad de razonamiento" hint="Más alto = mejor criterio, más lento y costoso.">
                <Select name="effort" defaultValue={s?.effort ?? "low"}>
                  <option value="low">Baja (rápido)</option>
                  <option value="medium">Media</option>
                  <option value="high">Alta</option>
                </Select>
              </Field>
              <Field label="Espera antes de responder (s)" hint="Agrupa mensajes enviados en ráfaga.">
                <Input name="reply_delay_seconds" type="number" min={0} max={60} defaultValue={s?.reply_delay_seconds ?? 6} />
              </Field>
            </div>
            <Field label="Mensajes de historial que lee" hint="Últimos N mensajes de la conversación.">
              <Input name="history_limit" type="number" min={6} max={200} defaultValue={s?.history_limit ?? 40} className="w-32" />
            </Field>
            <Field
              label="Instrucciones del asistente (prompt)"
              hint="Déjalo vacío para usar las instrucciones base. Aquí definiremos qué trámites atiende, requisitos, tono, etc."
            >
              <Textarea name="system_prompt" rows={16} defaultValue={s?.system_prompt ?? ""} placeholder={DEFAULT_AGENT_PROMPT} className="font-mono text-xs" />
            </Field>
            <Button>Guardar configuración</Button>
          </form>
        </Card>

        <Card>
          <CardHeader title="Equipo · asesores" />
          <p className="px-5 pt-4 text-xs text-muted">
            El asesor asignado a un prospecto aparece en el contrato de retiro por desempleo como “El Profesionista” (con su ciudad y estado como domicilio) y recibe el PDF en su WhatsApp.
          </p>
          <TeamPanel profiles={(profiles ?? []) as Profile[]} />
        </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="WhatsApp · Green API" />
            <GreenApiPanel defaultAppUrl={appUrl} />
          </Card>

          <Card>
            <CardHeader title="Variables de entorno" />
            <ul className="divide-y divide-line text-sm">
              {env.map(([label, ok]) => (
                <li key={label} className="flex items-center justify-between px-5 py-2.5">
                  <span>{label}</span>
                  <span className={ok ? "text-emerald-700" : "text-amber-700"}>{ok ? "✓ Listo" : "Falta"}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Captación de prospectos" />
            <div className="space-y-4 p-5 text-sm">
              <div>
                <p className="font-medium">Formulario público</p>
                <p className="mt-1 break-all font-mono text-xs text-muted">{appUrl}/registro?utm_source=facebook&utm_campaign=NOMBRE</p>
                <p className="mt-1 text-xs text-muted">Úsalo como destino de tus anuncios. Al terminar, abre WhatsApp con su folio y la IA continúa.</p>
              </div>
              <div>
                <p className="font-medium">Anuncio “Clic a WhatsApp”</p>
                <p className="mt-1 break-all font-mono text-xs text-muted">https://wa.me/{waNumber}</p>
                <p className="mt-1 text-xs text-muted">Los mensajes llegan directo al asistente y se crean como prospectos.</p>
              </div>
              <div>
                <p className="font-medium">API (Meta Lead Ads, Zapier, Make)</p>
                <pre className="mt-1 overflow-x-auto rounded-lg bg-stone-900 p-3 text-[11px] leading-relaxed text-stone-100">{`POST ${appUrl}/api/leads
x-api-key: <INTAKE_API_KEY>
{
  "full_name": "Ana López",
  "phone": "5512345678",
  "tramite_type": "Modalidad 40",
  "source": "facebook",
  "send_whatsapp": true
}`}</pre>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
