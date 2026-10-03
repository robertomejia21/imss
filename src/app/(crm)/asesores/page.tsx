import { createClient } from "@/lib/supabase/server";
import { TeamPanel } from "@/components/team-panel";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import type { Profile } from "@/lib/types";

export const metadata = { title: "Asesores" };

export default async function AdvisorsPage() {
  const supabase = await createClient();
  const { data: profiles } = await supabase.from("profiles").select("*").order("created_at");

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
      <PageHeader
        title="Asesores"
        description="El asesor asignado a un prospecto aparece en el contrato de retiro por desempleo como “El Profesionista”, con su ciudad y estado, y recibe el PDF en su WhatsApp."
      />
      <Card>
        <CardHeader title={`Equipo (${profiles?.length ?? 0})`} />
        <TeamPanel profiles={(profiles ?? []) as Profile[]} />
      </Card>
    </div>
  );
}
