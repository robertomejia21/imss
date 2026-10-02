import { createClient } from "@/lib/supabase/server";
import { Kanban } from "@/components/kanban";
import { PageHeader } from "@/components/ui";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import type { Lead } from "@/lib/types";

export const metadata = { title: "Embudo" };

export default async function PipelinePage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("leads")
    .select("*, documents(count)")
    .order("updated_at", { ascending: false })
    .limit(500);

  const leads = ((data ?? []) as (Lead & { documents: { count: number }[] })[]).map(({ documents, ...l }) => ({
    ...l,
    doc_count: documents?.[0]?.count ?? 0,
  }));

  return (
    <div className="px-4 py-8 sm:px-8">
      <RealtimeRefresh channel="pipeline" tables={["leads"]} />
      <PageHeader title="Embudo" description="Arrastra las tarjetas para cambiar el estado de cada prospecto." />
      <Kanban leads={leads} />
    </div>
  );
}
