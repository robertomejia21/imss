import Image from "next/image";
import { LoginForm } from "./login-form";

export const metadata = { title: "Iniciar sesión" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden overflow-hidden bg-brand-600 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-24 -bottom-24 size-[28rem] rounded-full bg-brand-500/40" />
        <div className="absolute -right-10 top-24 size-40 rounded-full bg-brand-700/60" />
        <div className="relative flex items-center gap-3">
          <Image src="/logo.png" alt="" width={44} height={44} className="rounded-xl bg-white/10" />
          <span className="text-lg font-semibold">CRM Trámites IMSS</span>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-4xl font-semibold leading-tight">Acompaña a cada familia de principio a fin.</h1>
          <p className="mt-4 text-brand-100">
            Prospectos de WhatsApp, verificación de documentos y seguimiento de trámites en un solo lugar.
          </p>
        </div>
        <p className="relative text-xs text-brand-200">Asistente de IA atendiendo 24/7</p>
      </section>

      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Image src="/logo.png" alt="" width={40} height={40} />
            <span className="font-semibold text-brand-700">CRM Trámites IMSS</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">Iniciar sesión</h2>
          <p className="mb-6 mt-1 text-sm text-muted">Acceso para asesores del equipo.</p>
          <LoginForm next={typeof next === "string" ? next : undefined} />
        </div>
      </section>
    </main>
  );
}
