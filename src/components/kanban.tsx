"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { Bot, FileText } from "lucide-react";
import { updateLeadStatus } from "@/app/(crm)/actions";
import { LEAD_STATUSES } from "@/lib/constants";
import { cn, displayName, timeAgo } from "@/lib/utils";
import type { Lead, LeadStatus } from "@/lib/types";

type CardLead = Lead & { doc_count: number };

export function Kanban({ leads }: { leads: CardLead[] }) {
  const [, start] = useTransition();
  const [optimistic, move] = useOptimistic(leads, (state, { id, status }: { id: string; status: LeadStatus }) =>
    state.map((l) => (l.id === id ? { ...l, status } : l)),
  );
  const [dragOver, setDragOver] = useState<LeadStatus | null>(null);

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-thin">
      {LEAD_STATUSES.map((col) => {
        const items = optimistic.filter((l) => l.status === col.value);
        return (
          <section
            key={col.value}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(col.value);
            }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              const id = e.dataTransfer.getData("text/plain");
              const lead = optimistic.find((l) => l.id === id);
              if (!lead || lead.status === col.value) return;
              start(async () => {
                move({ id, status: col.value });
                await updateLeadStatus(id, col.value);
              });
            }}
            className={cn(
              "flex w-72 shrink-0 flex-col rounded-xl bg-stone-100/70 transition-colors",
              dragOver === col.value && "bg-brand-50 ring-2 ring-brand-300",
            )}
          >
            <header className="flex items-center justify-between px-3 py-2.5">
              <h2 className="text-sm font-semibold text-ink">{col.label}</h2>
              <span className="rounded-full bg-white px-2 text-xs font-medium tabular-nums text-muted">{items.length}</span>
            </header>
            <div className="flex min-h-24 flex-col gap-2 px-2 pb-2">
              {items.map((l) => (
                <article
                  key={l.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", l.id)}
                  className="cursor-grab rounded-lg border border-line bg-paper p-3 shadow-card active:cursor-grabbing"
                >
                  <Link href={`/leads/${l.id}`} className="block">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-ink">{displayName(l)}</p>
                      {l.needs_human && <span className="mt-1 size-2 shrink-0 rounded-full bg-amber-500" title="Requiere asesor" />}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted">{l.tramite_type ?? "Trámite sin definir"}</p>
                    <div className="mt-2 flex items-center gap-3 text-[11px] text-muted">
                      <span>{timeAgo(l.last_message_at ?? l.created_at)}</span>
                      {l.doc_count > 0 && (
                        <span className="flex items-center gap-0.5">
                          <FileText className="size-3" /> {l.doc_count}
                        </span>
                      )}
                      {!l.ai_enabled && (
                        <span className="flex items-center gap-0.5">
                          <Bot className="size-3" /> pausa
                        </span>
                      )}
                    </div>
                  </Link>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
