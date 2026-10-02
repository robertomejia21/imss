import Image from "next/image";
import { CheckCircle2 } from "lucide-react";
import { RegistroForm } from "./registro-form";

export const metadata = { title: "Registro", description: "Te ayudamos con tu trámite del IMSS" };

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "ad_id"];

export default async function RegistroPage({ searchParams }: PageProps<"/registro">) {
  const sp = await searchParams;
  const utm = Object.fromEntries(
    UTM_KEYS.flatMap((k) => (typeof sp[k] === "string" ? [[k, sp[k] as string]] : [])),
  );

  return (
    <main className="min-h-screen bg-cream">
      <div className="bg-brand-600 px-4 pb-28 pt-8 text-white">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <Image src="/logo.png" alt="" width={44} height={44} className="rounded-xl" />
          <span className="font-semibold">Trámites IMSS</span>
        </div>
        <div className="mx-auto mt-8 max-w-xl">
          <h1 className="text-3xl font-semibold leading-tight">Te ayudamos con tu trámite del IMSS</h1>
          <ul className="mt-4 space-y-1.5 text-sm text-brand-100">
            {["Atención inmediata por WhatsApp", "Revisamos tus documentos sin salir de casa", "Seguimiento de tu trámite paso a paso"].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-brand-200" /> {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mx-auto -mt-20 max-w-xl px-4 pb-12">
        <div className="rounded-2xl border border-line bg-paper p-6 shadow-lg sm:p-8">
          <h2 className="mb-1 text-lg font-semibold">Completa tu registro</h2>
          <p className="mb-6 text-sm text-muted">Toma menos de un minuto. Al terminar seguimos por WhatsApp.</p>
          <RegistroForm utm={utm} />
        </div>
      </div>
    </main>
  );
}
