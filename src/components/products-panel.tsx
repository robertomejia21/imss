"use client";

import { useRef, useState, useTransition } from "react";
import { PackagePlus } from "lucide-react";
import { createProduct, updateProduct } from "@/app/(crm)/actions";
import { Button, Field, Input, Textarea } from "./ui";
import type { Product } from "@/lib/types";

/** Catálogo de productos: descripción para el agente de IA, si él lo ofrece y si está activo. */
export function ProductsPanel({ products }: { products: Product[] }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null);
  const form = useRef<HTMLFormElement>(null);

  return (
    <div className="divide-y divide-line">
      {products.map((p) => (
        <form key={p.id} action={updateProduct.bind(null, p.id)} className="space-y-2 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={`font-medium ${p.active ? "text-ink" : "text-muted line-through"}`}>{p.name}</p>
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted">
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" name="active" defaultChecked={p.active} className="size-4 accent-brand-600" /> Activo
              </label>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" name="offered_by_ai" defaultChecked={p.offered_by_ai} className="size-4 accent-brand-600" /> Lo ofrece la IA
              </label>
              <label className="flex items-center gap-1.5">
                Orden
                <Input name="sort_order" type="number" defaultValue={p.sort_order} className="h-8 w-20" />
              </label>
            </div>
          </div>
          <Textarea
            name="description"
            rows={2}
            defaultValue={p.description}
            placeholder="Qué es, precio, requisitos y datos que la IA debe pedir (opcional)"
          />
          <Button variant="secondary" size="sm">
            Guardar
          </Button>
        </form>
      ))}

      <details className="px-5 py-4">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-brand-600">
          <PackagePlus className="size-4" /> Agregar producto
        </summary>
        <form
          ref={form}
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            start(async () => {
              const r = await createProduct(data);
              setMsg(r.error ? { text: r.error } : { ok: true, text: "Producto agregado." });
              if (!r.error) form.current?.reset();
            });
          }}
        >
          <Field label="Nombre" hint="No se puede cambiar después: así queda registrado en cada prospecto.">
            <Input name="name" required placeholder="Ej. Modalidad 10" />
          </Field>
          <Field label="Descripción para la IA">
            <Textarea name="description" rows={3} placeholder="Qué es, cuánto cuesta, para quién es y qué datos o documentos pedir" />
          </Field>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" name="offered_by_ai" className="size-4 accent-brand-600" /> La IA lo ofrece por WhatsApp
          </label>
          <Button disabled={pending}>{pending ? "Guardando…" : "Agregar producto"}</Button>
          {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p>}
        </form>
      </details>
    </div>
  );
}
