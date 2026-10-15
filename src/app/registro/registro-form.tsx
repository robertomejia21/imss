"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { submitRegistro } from "./actions";
import { Button, Field, Input, Textarea } from "@/components/ui";

export function RegistroForm({ utm, products }: { utm: Record<string, string>; products: string[] }) {
  const [state, action, pending] = useActionState(submitRegistro, undefined);
  const err = (k: string) => state?.errors?.[k]?.[0];

  return (
    <form action={action} className="space-y-4">
      {Object.entries(utm).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="text" name="company" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />

      <Field label="Nombre completo *">
        <Input name="full_name" required autoComplete="name" placeholder="Como aparece en tu INE" />
        {err("full_name") && <p className="mt-1 text-xs text-red-600">{err("full_name")}</p>}
      </Field>
      <Field label="WhatsApp *">
        <Input name="phone" required inputMode="tel" autoComplete="tel" placeholder="10 dígitos" />
        {err("phone") && <p className="mt-1 text-xs text-red-600">{err("phone")}</p>}
      </Field>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink">¿Qué te interesa? *</legend>
        <p className="mb-2 text-xs text-muted">Puedes elegir más de uno.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {products.map((p) => (
            <label
              key={p}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50"
            >
              <input type="checkbox" name="products" value={p} className="size-4 accent-brand-600" />
              {p}
            </label>
          ))}
        </div>
        {err("products") && <p className="mt-1 text-xs text-red-600">{err("products")}</p>}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="CURP (opcional)">
          <Input name="curp" maxLength={18} className="uppercase" />
        </Field>
        <Field label="NSS (opcional)">
          <Input name="nss" inputMode="numeric" maxLength={11} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Correo (opcional)">
          <Input name="email" type="email" autoComplete="email" />
          {err("email") && <p className="mt-1 text-xs text-red-600">{err("email")}</p>}
        </Field>
        <Field label="Ciudad (opcional)">
          <Input name="city" autoComplete="address-level2" />
        </Field>
      </div>
      <Field label="Cuéntanos tu caso (opcional)">
        <Textarea name="message" rows={3} />
      </Field>

      <label className="flex items-start gap-2 text-xs text-muted">
        <input type="checkbox" name="privacy" className="mt-0.5 size-4 accent-brand-600" required />
        <span>Acepto el{" "}
          <a href="/aviso-de-privacidad" target="_blank" className="font-medium text-brand-700 underline">
            aviso de privacidad
          </a>{" "}
          y que me contacten por WhatsApp para dar seguimiento a mi trámite.</span>
      </label>
      {err("privacy") && <p className="text-xs text-red-600">{err("privacy")}</p>}
      {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}

      <Button className="h-12 w-full text-base" disabled={pending}>
        {pending ? <Loader2 className="size-5 animate-spin" /> : "Enviar y continuar en WhatsApp"}
      </Button>
    </form>
  );
}
