import Image from "next/image";
import { MessageCircle } from "lucide-react";
import { AutoRedirect } from "./auto-redirect";

export const metadata = { title: "¡Registro recibido!" };

export default async function GraciasPage({ searchParams }: PageProps<"/registro/gracias">) {
  const sp = await searchParams;
  const folio = typeof sp.folio === "string" ? sp.folio : "";
  const name = typeof sp.n === "string" ? sp.n : "";
  const number = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "";
  // El folio en el mensaje permite vincular el chat con el registro aunque escriba desde otro número
  const text = `Hola, soy ${name || "una persona registrada"}. Terminé mi registro, mi folio es ${folio}.`;
  const waUrl = `https://wa.me/${number}?text=${encodeURIComponent(text)}`;

  return (
    <main className="flex min-h-screen items-center justify-center bg-cream p-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-paper p-8 text-center shadow-lg">
        <Image src="/logo.png" alt="" width={64} height={64} className="mx-auto" />
        <h1 className="mt-6 text-2xl font-semibold">¡Gracias{name ? `, ${name}` : ""}!</h1>
        <p className="mt-2 text-sm text-muted">Recibimos tu registro. Tu folio es</p>
        <p className="mt-1 font-mono text-2xl font-semibold tracking-wider text-brand-700">{folio}</p>
        <p className="mt-6 text-sm text-ink">Ahora continúa por WhatsApp para enviar tus documentos y dar seguimiento.</p>
        <a
          href={waUrl}
          className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand-600 text-base font-medium text-white shadow-sm hover:bg-brand-700"
        >
          <MessageCircle className="size-5" /> Continuar en WhatsApp
        </a>
        <AutoRedirect url={waUrl} seconds={5} />
      </div>
    </main>
  );
}
