"use client";

import { useRef, useState, useTransition } from "react";
import { Pencil, UserPlus } from "lucide-react";
import { createAdvisor, updateAdvisor } from "@/app/(crm)/actions";
import { Avatar, Button, Field, Input } from "./ui";
import { formatPhone } from "@/lib/utils";
import type { Profile } from "@/lib/types";

/** Asesores del CRM: nombre, ciudad y estado (van en el contrato como "El Profesionista") y WhatsApp (recibe contratos y expedientes). */
export function TeamTable({ profiles }: { profiles: Profile[] }) {
  const [editing, setEditing] = useState<string | null>(null);

  if (profiles.length === 0) return <p className="px-5 py-4 text-sm text-muted">Todavía no hay asesores registrados.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="border-b border-line bg-stone-50/70 text-left text-xs font-medium text-muted">
          <tr>
            <th className="px-5 py-3">Asesor</th>
            <th className="px-3 py-3">WhatsApp</th>
            <th className="px-3 py-3">Ciudad</th>
            <th className="px-3 py-3">Estado</th>
            <th className="px-3 py-3">Rol</th>
            <th className="px-5 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {profiles.map((p) =>
            editing === p.id ? (
              <EditRow key={p.id} p={p} onDone={() => setEditing(null)} />
            ) : (
              <tr key={p.id} className="hover:bg-stone-50">
                <td className="px-5 py-2.5">
                  <div className="flex items-center gap-3">
                    <Avatar name={p.full_name ?? p.email ?? "?"} className="size-8" />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{p.full_name ?? "Sin nombre"}</p>
                      <p className="truncate text-xs text-muted">{p.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-muted">{p.phone ? formatPhone(p.phone) : <span className="text-amber-700">Sin WhatsApp</span>}</td>
                <td className="px-3 py-2.5 text-muted">{p.city ?? "—"}</td>
                <td className="px-3 py-2.5 text-muted">{p.state ?? "—"}</td>
                <td className="px-3 py-2.5 capitalize text-muted">{p.role}</td>
                <td className="px-5 py-2.5 text-right">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(p.id)}>
                    <Pencil className="size-3.5" /> Editar
                  </Button>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Fila en modo edición. Un <form> no puede envolver celdas, así que los inputs se ligan con `form={id}`. */
function EditRow({ p, onDone }: { p: Profile; onDone: () => void }) {
  const [pending, start] = useTransition();
  const formId = `advisor-${p.id}`;
  return (
    <tr className="bg-brand-50/40">
      <td className="px-5 py-2.5">
        <Input form={formId} name="full_name" defaultValue={p.full_name ?? ""} placeholder="Nombre completo" className="h-9" autoFocus />
        <p className="mt-1 truncate text-xs text-muted">{p.email}</p>
      </td>
      <td className="px-3 py-2.5 align-top">
        <Input form={formId} name="phone" defaultValue={p.phone?.slice(-10) ?? ""} placeholder="10 dígitos" inputMode="tel" className="h-9" />
      </td>
      <td className="px-3 py-2.5 align-top">
        <Input form={formId} name="city" defaultValue={p.city ?? ""} placeholder="Ej. Los Mochis" className="h-9" />
      </td>
      <td className="px-3 py-2.5 align-top">
        <Input form={formId} name="state" defaultValue={p.state ?? ""} placeholder="Ej. Sinaloa" className="h-9" />
      </td>
      <td className="px-3 py-2.5 align-top capitalize text-muted">{p.role}</td>
      <td className="px-5 py-2.5 align-top">
        <form
          id={formId}
          className="flex justify-end gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            start(async () => {
              await updateAdvisor(p.id, data);
              onDone();
            });
          }}
        >
          <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={pending}>
            Cancelar
          </Button>
          <Button size="sm" disabled={pending}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </form>
      </td>
    </tr>
  );
}

export function AdvisorForm() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null);
  const form = useRef<HTMLFormElement>(null);

  return (
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
  );
}
