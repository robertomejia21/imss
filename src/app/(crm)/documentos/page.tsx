import Link from "next/link";
import { FileCheck2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { DocumentCard } from "@/components/lead-widgets";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { EmptyState, PageHeader } from "@/components/ui";
import { DOCUMENT_STATUSES } from "@/lib/constants";
import { cn, displayName } from "@/lib/utils";
import type { DocumentRow, Lead } from "@/lib/types";

export const metadata = { title: "Documentos" };

export default async function DocumentsPage({ searchParams }: PageProps<"/documentos">) {
  const sp = await searchParams;
  const status = typeof sp.status === "string" ? sp.status : "por_revisar";

  const supabase = await createClient();
  let query = supabase
    .from("documents")
    .select("*, leads(id, full_name, wa_name, phone)")
    .order("created_at", { ascending: false })
    .limit(120);
  if (status === "por_revisar") query = query.in("status", ["con_observaciones", "invalido", "error"]).is("reviewed_at", null);
  else if (status !== "todos") query = query.eq("status", status);
  const { data } = await query;

  type Row = DocumentRow & { leads: Pick<Lead, "id" | "full_name" | "wa_name" | "phone"> | null };
  const docs = (data ?? []) as Row[];

  const tabs = [
    { key: "por_revisar", label: "Por revisar" },
    { key: "todos", label: "Todos" },
    ...Object.entries(DOCUMENT_STATUSES).map(([key, m]) => ({ key, label: m.label })),
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <RealtimeRefresh channel="documents" tables={["documents"]} />
      <PageHeader
        title="Documentos"
        description="Identificaciones y documentos recibidos por WhatsApp, verificados automáticamente con OCR."
      />
      <div className="mb-5 flex gap-1.5 overflow-x-auto">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/documentos?status=${t.key}`}
            className={cn(
              "whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium",
              status === t.key ? "bg-brand-600 text-white" : "bg-stone-100 text-muted hover:bg-stone-200",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {docs.length === 0 ? (
        <EmptyState icon={<FileCheck2 className="size-10" />} title="Nada por aquí" description="No hay documentos en esta vista." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {docs.map(({ leads: lead, ...d }) => (
            <div key={d.id} className="rounded-xl bg-paper shadow-card">
              {lead && (
                <Link href={`/leads/${lead.id}`} className="block border-b border-line px-3 py-2 text-xs font-medium text-brand-700 hover:underline">
                  {displayName(lead)}
                </Link>
              )}
              <div className="p-1">
                <DocumentCard doc={d} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
