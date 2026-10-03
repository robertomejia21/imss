"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { FileCheck2, KanbanSquare, LayoutDashboard, LogOut, Menu, MessagesSquare, Settings, UserCog, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Inicio", icon: LayoutDashboard },
  { href: "/inbox", label: "Conversaciones", icon: MessagesSquare, badge: "inbox" as const },
  { href: "/leads", label: "Prospectos", icon: Users },
  { href: "/pipeline", label: "Embudo", icon: KanbanSquare },
  { href: "/documentos", label: "Documentos", icon: FileCheck2 },
  { href: "/asesores", label: "Asesores", icon: UserCog },
  { href: "/configuracion", label: "Configuración", icon: Settings },
];

export function Sidebar({ user, needsHuman }: { user: { email: string; name: string }; needsHuman: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav className="flex flex-1 flex-col gap-1 px-3">
      {NAV.map(({ href, label, icon: Icon, badge }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-white/12 text-white" : "text-brand-100/80 hover:bg-white/8 hover:text-white",
            )}
          >
            <Icon className="size-4.5" strokeWidth={1.8} />
            <span className="flex-1">{label}</span>
            {badge === "inbox" && needsHuman > 0 && (
              <span className="rounded-full bg-amber-400 px-1.5 text-[11px] font-semibold text-brand-950" title="Requieren asesor">
                {needsHuman}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  const content = (
    <div className="flex h-full flex-col bg-brand-700 py-5">
      <div className="mb-8 flex items-center gap-3 px-6">
        <Image src="/logo.png" alt="" width={36} height={36} className="rounded-lg" />
        <div className="leading-tight">
          <p className="text-sm font-semibold text-white">CRM Trámites</p>
          <p className="text-xs text-brand-200">IMSS</p>
        </div>
      </div>
      {nav}
      <div className="mx-3 mt-4 border-t border-white/10 px-3 pt-4">
        <p className="truncate text-sm font-medium text-white">{user.name}</p>
        <p className="truncate text-xs text-brand-200">{user.email}</p>
        <form action="/auth/signout" method="post" className="mt-3">
          <button className="flex items-center gap-2 text-xs text-brand-200 hover:text-white">
            <LogOut className="size-3.5" /> Cerrar sesión
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 lg:block">{content}</aside>

      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-paper px-4 py-3 lg:hidden">
        <button onClick={() => setOpen(true)} aria-label="Abrir menú" className="text-ink">
          <Menu className="size-5" />
        </button>
        <Image src="/logo.png" alt="" width={28} height={28} />
        <span className="text-sm font-semibold text-brand-700">CRM Trámites IMSS</span>
      </div>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64">
            {content}
            <button onClick={() => setOpen(false)} className="absolute right-3 top-5 text-white" aria-label="Cerrar menú">
              <X className="size-5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
