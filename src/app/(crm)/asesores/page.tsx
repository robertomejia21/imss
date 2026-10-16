import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AdvisorForm, TeamTable } from "@/components/team-panel";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { Profile } from "@/lib/types";

export const metadata = { title: "Asesores" };

const PAGE_SIZE = 20;

export default async function AdvisorsPage({ searchParams }: PageProps<"/asesores">) {
  const sp = await searchParams;
  const requested = Math.max(1, Math.floor(Number(typeof sp.page === "string" ? sp.page : 1)) || 1);

  const supabase = await createClient();
  const { count } = await supabase.from("profiles").select("id", { count: "exact", head: true });
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requested, pages);
  const from = (page - 1) * PAGE_SIZE;
  const { data: profiles } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at")
    .range(from, from + PAGE_SIZE - 1);

  const pageLink = (p: number, label: ReactNode, disabled: boolean, aria: string) => (
    <Link
      href={`/asesores?page=${p}`}
      aria-label={aria}
      aria-disabled={disabled}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-lg border border-line bg-paper text-muted hover:text-ink",
        disabled && "pointer-events-none opacity-40",
      )}
    >
      {label}
    </Link>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
      <PageHeader
        title="Asesores"
        description="El asesor asignado a un prospecto aparece en el contrato de retiro por desempleo como “El Profesionista”, con su ciudad y estado, y recibe el PDF y los expedientes en su WhatsApp."
      />
      <Card className="overflow-hidden">
        <CardHeader title={`Equipo (${total})`} />
        <TeamTable profiles={(profiles ?? []) as Profile[]} />
        {pages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm text-muted">
            <span>
              {from + 1}–{Math.min(from + PAGE_SIZE, total)} de {total}
            </span>
            <div className="flex items-center gap-2">
              {pageLink(page - 1, <ChevronLeft className="size-4" />, page <= 1, "Página anterior")}
              <span>
                Página {page} de {pages}
              </span>
              {pageLink(page + 1, <ChevronRight className="size-4" />, page >= pages, "Página siguiente")}
            </div>
          </div>
        )}
      </Card>
      <Card className="mt-6">
        <AdvisorForm />
      </Card>
    </div>
  );
}
