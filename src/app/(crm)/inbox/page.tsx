import Link from "next/link";
import { Bot, MessagesSquare, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ChatPanel } from "@/components/chat-panel";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { Avatar, EmptyState } from "@/components/ui";
import { cn, displayName, timeAgo } from "@/lib/utils";
import type { DocumentRow, Lead, Message } from "@/lib/types";

export const metadata = { title: "Conversaciones" };

const FILTERS = [
  { key: "todas", label: "Todas" },
  { key: "asesor", label: "Requieren asesor" },
  { key: "no_leidas", label: "No leídas" },
  { key: "pausa", label: "IA en pausa" },
] as const;

export default async function InboxPage({ searchParams }: PageProps<"/inbox">) {
  const sp = await searchParams;
  const selectedId = typeof sp.lead === "string" ? sp.lead : undefined;
  const filter = typeof sp.f === "string" ? sp.f : "todas";
  const q = typeof sp.q === "string" ? sp.q.replace(/[,()%*]/g, " ").trim() : "";

  const supabase = await createClient();
  let query = supabase
    .from("leads")
    .select("*")
    .not("last_message_at", "is", null)
    .order("last_message_at", { ascending: false })
    .limit(100);
  if (filter === "asesor") query = query.eq("needs_human", true);
  if (filter === "no_leidas") query = query.gt("unread_count", 0);
  if (filter === "pausa") query = query.eq("ai_enabled", false);
  if (q) query = query.or(`full_name.ilike.%${q}%,wa_name.ilike.%${q}%,phone.ilike.%${q}%,folio.ilike.%${q}%`);
  const { data } = await query;
  const leads = (data ?? []) as Lead[];

  // Último mensaje de cada conversación para la vista previa
  const previews = new Map<string, Message>();
  if (leads.length) {
    const { data: msgs } = await supabase
      .from("messages")
      .select("lead_id, body, type, direction, created_at, transcription")
      .in(
        "lead_id",
        leads.map((l) => l.id),
      )
      .order("created_at", { ascending: false })
      .limit(400);
    for (const m of (msgs ?? []) as Message[]) if (!previews.has(m.lead_id)) previews.set(m.lead_id, m);
  }

  let selected: { lead: Lead; messages: Message[]; docs: DocumentRow[] } | null = null;
  if (selectedId) {
    const [{ data: lead }, { data: messages }, { data: docs }] = await Promise.all([
      supabase.from("leads").select("*").eq("id", selectedId).single(),
      supabase.from("messages").select("*").eq("lead_id", selectedId).order("created_at", { ascending: true }).limit(300),
      supabase.from("documents").select("*").eq("lead_id", selectedId),
    ]);
    if (lead) selected = { lead: lead as Lead, messages: (messages ?? []) as Message[], docs: (docs ?? []) as DocumentRow[] };
  }

  const href = (params: Record<string, string | undefined>) => {
    const s = new URLSearchParams();
    const merged = { f: filter, q, lead: selectedId, ...params };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "f" && v === "todas")) s.set(k, v);
    return `/inbox?${s.toString()}`;
  };

  const preview = (m?: Message) => {
    if (!m) return "";
    const prefix = m.direction === "out" ? "Tú: " : "";
    if (m.type === "audio") return `${prefix}🎤 ${m.transcription ?? "Nota de voz"}`;
    if (m.type === "image") return `${prefix}📷 ${m.body ?? "Imagen"}`;
    if (m.type === "document") return `${prefix}📄 ${m.body ?? "Documento"}`;
    return prefix + (m.body ?? "");
  };

  return (
    <div className="flex h-[calc(100vh-57px)] lg:h-screen">
      <RealtimeRefresh channel="inbox" tables={["leads"]} />
      <aside className={cn("flex w-full flex-col border-r border-line bg-paper md:w-80 lg:w-96", selected && "hidden md:flex")}>
        <div className="border-b border-line p-4">
          <h1 className="mb-3 text-lg font-semibold">Conversaciones</h1>
          <form action="/inbox" className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
            <input
              name="q"
              defaultValue={q}
              placeholder="Buscar nombre, teléfono o folio"
              className="h-9 w-full rounded-lg border border-line bg-cream pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none"
            />
            {filter !== "todas" && <input type="hidden" name="f" value={filter} />}
          </form>
          <div className="mt-3 flex gap-1.5 overflow-x-auto">
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={href({ f: f.key, lead: undefined })}
                className={cn(
                  "whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium",
                  filter === f.key ? "bg-brand-600 text-white" : "bg-stone-100 text-muted hover:bg-stone-200",
                )}
              >
                {f.label}
              </Link>
            ))}
          </div>
        </div>
        <ul className="scrollbar-thin flex-1 divide-y divide-line overflow-y-auto">
          {leads.length === 0 && <EmptyState title="Sin conversaciones" description="Prueba con otro filtro." />}
          {leads.map((l) => (
            <li key={l.id}>
              <Link
                href={href({ lead: l.id })}
                className={cn("flex gap-3 px-4 py-3 hover:bg-stone-50", l.id === selectedId && "bg-brand-50 hover:bg-brand-50")}
              >
                <Avatar name={displayName(l)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={cn("truncate text-sm text-ink", l.unread_count > 0 ? "font-semibold" : "font-medium")}>{displayName(l)}</p>
                    <span className="shrink-0 text-[11px] text-muted">{timeAgo(l.last_message_at)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    {!l.ai_enabled && <Bot className="size-3.5 shrink-0 text-stone-400" aria-label="IA en pausa" />}
                    <p className="flex-1 truncate text-xs text-muted">{preview(previews.get(l.id))}</p>
                    {l.needs_human && <span className="size-2 shrink-0 rounded-full bg-amber-500" title="Requiere asesor" />}
                    {l.unread_count > 0 && (
                      <span className="shrink-0 rounded-full bg-brand-600 px-1.5 text-[10px] font-semibold text-white">{l.unread_count}</span>
                    )}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </aside>

      <section className={cn("min-w-0 flex-1", !selected && "hidden md:block")}>
        {selected ? (
          <div className="flex h-full flex-col">
            <Link href={href({ lead: undefined })} className="border-b border-line bg-paper px-4 py-2 text-xs font-medium text-brand-600 md:hidden">
              ← Volver
            </Link>
            <div className="min-h-0 flex-1">
              <ChatPanel key={selected.lead.id} lead={selected.lead} initialMessages={selected.messages} initialDocs={selected.docs} />
            </div>
          </div>
        ) : (
          <div className="chat-wallpaper flex h-full items-center justify-center">
            <EmptyState icon={<MessagesSquare className="size-10" />} title="Selecciona una conversación" description="Aquí verás el chat de WhatsApp en tiempo real." />
          </div>
        )}
      </section>
    </div>
  );
}
