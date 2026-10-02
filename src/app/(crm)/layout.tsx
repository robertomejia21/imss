import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { createClient } from "@/lib/supabase/server";

export default async function CrmLayout({ children }: LayoutProps<"/">) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { count }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("needs_human", true),
  ]);

  return (
    <div className="min-h-screen">
      <Sidebar
        user={{ email: user.email ?? "", name: profile?.full_name ?? user.email?.split("@")[0] ?? "Asesor" }}
        needsHuman={count ?? 0}
      />
      <main className="lg:pl-60">{children}</main>
    </div>
  );
}
