"use client";

import { useRef, useState, useTransition } from "react";
import { UserPlus } from "lucide-react";
import { createAdvisor, updateAdvisor } from "@/app/(crm)/actions";
import { Button, Field, Input } from "./ui";
import type { Profile } from "@/lib/types";

/** Asesores del CRM: nombre, ciudad y estado (van en el contrato como "El Profesionista") y WhatsApp (recibe el contrato en PDF). */
export function TeamPanel({ profiles }: { profiles: Profile[] }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null);
  const form = useRef<HTMLFormElement>(null);

  return (
    <div className="divide-y divide-line">
      {profiles.length === 0 && <p className="px-5 py-4 text-sm text-muted">Todavía no hay asesores registrados.</p>}
      {profiles.map((p) => (
        <form key={p.id} action={updateAdvisor.bind(null, p.id)} className="grid gap-2 px-5 py-3 sm:grid-cols-2 sm:items-end">
          <Field label={p.email ?? "Asesor"}>
            <Input name="full_name" defaultValue={p.full_name ?? ""} placeholder="Nombre completo" />
          </Field>
          <Field label="WhatsApp">
            <Input name="phone" defaultValue={p.phone?.slice(-10) ?? ""} placeholder="10 dígitos" inputMode="tel" />
          </Field>
          <Field label="Ciudad">
            <Input name="city" defaultValue={p.city ?? ""} placeholder="Ej. Los Mochis" />
          </Field>
          <Field label="Estado">
            <Input name="state" defaultValue={p.state ?? ""} placeholder="Ej. Sinaloa" />
          </Field>
          <Button variant="secondary" size="sm" className="h-10 sm:col-span-2">
            Guardar
          </Button>
        </form>
      ))}

      <details className="px-5 py-4">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-brand-600">
          <UserPlus className="size-4" /> Registrar asesor
        </summary>
        <form
          ref={form}
          className="mt-3 grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            start(async () => {
              const r = await createAdvisor(data);
              setMsg(r.error ? { text: r.error } : { ok: true, text: "Asesor registrado. Ya puede iniciar sesión con su correo y contraseña." });
              if (!r.error) form.current?.reset();
            });
          }}
        >
          <Field label="Nombre completo">
            <Input name="full_name" required />
          </Field>
          <Field label="WhatsApp">
            <Input name="phone" placeholder="10 dígitos" inputMode="tel" />
          </Field>
          <Field label="Ciudad">
            <Input name="city" required placeholder="Ej. Los Mochis" />
          </Field>
          <Field label="Estado">
            <Input name="state" required placeholder="Ej. Sinaloa" />
          </Field>
          <Field label="Correo">
            <Input name="email" type="email" required />
          </Field>
          <Field label="Contraseña" hint="Mínimo 8 caracteres.">
            <Input name="password" type="password" minLength={8} required />
          </Field>
          <Button disabled={pending} className="sm:col-span-2">
            {pending ? "Registrando…" : "Registrar asesor"}
          </Button>
          {msg && <p className={`text-sm sm:col-span-2 ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p>}
        </form>
      </details>
    </div>
  );
}
