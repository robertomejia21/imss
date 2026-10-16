import Image from "next/image";
import { FileText } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizationData, leadBySigningToken } from "@/lib/authorization-form";
import { COMPANY } from "@/lib/company";
import { SignatureForm } from "./signature-form";

export const metadata = { title: "Firma tu autorización", robots: { index: false } };

export default async function FirmaPage({ params }: PageProps<"/firma/[token]">) {
  const { token } = await params;
  const lead = await leadBySigningToken(createAdminClient(), token);
  const data = lead ? authorizationData(lead) : null;
  const today = new Date().toLocaleDateString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "long" });

  return (
    <main className="min-h-screen bg-cream">
      <div className="bg-brand-600 px-4 pb-24 pt-8 text-white">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <Image src="/logo.png" alt="" width={44} height={44} className="rounded-xl" />
          <span className="font-semibold">{COMPANY.name}</span>
        </div>
        <h1 className="mx-auto mt-8 max-w-xl text-2xl font-semibold leading-tight">Autorización de consulta para tu préstamo vía nómina</h1>
      </div>

      <div className="mx-auto -mt-16 max-w-xl px-4 pb-12">
        <div className="rounded-2xl border border-line bg-paper p-6 shadow-lg sm:p-8">
          {!lead || !data ? (
            <div className="text-center">
              <p className="font-semibold text-ink">Este enlace ya no es válido</p>
              <p className="mt-1 text-sm text-muted">Puede que ya hayas firmado o que el enlace haya vencido. Escríbenos por WhatsApp y te enviamos uno nuevo.</p>
            </div>
          ) : (
            <div className="space-y-6">
              <p className="text-sm text-stone-700">
                Este formato autoriza a <strong>Consubanco</strong> a revisar tu información laboral en la plataforma Nomi-Pay y a apartar tu
                capacidad de descuento para tu préstamo. <strong>No es una consulta de buró de crédito.</strong> Ya lo llenamos con tus datos;
                revísalos y fírmalo.
              </p>

              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl bg-stone-50 p-4 text-sm">
                <dt className="text-muted">Fecha</dt>
                <dd className="font-medium text-ink">{today}</dd>
                <dt className="text-muted">No. de empleado / RFC</dt>
                <dd className="font-medium text-ink">{data.numeroEmpleadoRfc ?? "—"}</dd>
                <dt className="text-muted">Nombre</dt>
                <dd className="font-medium text-ink">{data.nombre ?? "—"}</dd>
              </dl>

              <a
                href={`/firma/${token}/pdf`}
                target="_blank"
                className="flex items-center justify-center gap-2 rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-brand-700 hover:bg-stone-50"
              >
                <FileText className="size-4" /> Ver el formato completo
              </a>

              <p className="text-xs text-muted">Si algún dato está mal, no firmes: avísanos por WhatsApp para corregirlo.</p>

              <SignatureForm token={token} />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
