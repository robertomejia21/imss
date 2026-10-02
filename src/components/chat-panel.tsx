"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Bot, Check, CheckCheck, FileText, Loader2, Mic, Pause, Play, Send, UserRound, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { markRead, resolveHumanRequest, sendManualMessage, setAiEnabled, triggerAiReply } from "@/app/(crm)/actions";
import { Avatar, Button } from "./ui";
import { DocStatusBadge, LeadStatusBadge } from "./status-badge";
import { DOC_TYPES } from "@/lib/constants";
import { cn, displayName, formatPhone, formatTime } from "@/lib/utils";
import type { DocumentRow, Lead, Message } from "@/lib/types";

function useSignedUrl(path: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    createClient()
      .storage.from("media")
      .createSignedUrl(path, 3600)
      .then(({ data }) => alive && setUrl(data?.signedUrl ?? null));
    return () => {
      alive = false;
    };
  }, [path]);
  return url;
}

function MediaContent({ m, doc }: { m: Message; doc?: DocumentRow }) {
  const url = useSignedUrl(m.media_path);
  const processing = Boolean(m.meta?.processing);

  if (m.type === "image") {
    return (
      <div className="space-y-2">
        {url ? (
          <a href={url} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="Imagen enviada" className="max-h-72 rounded-lg object-cover" />
          </a>
        ) : (
          <div className="flex h-40 w-56 items-center justify-center rounded-lg bg-black/5 text-xs text-muted">
            {processing ? <Loader2 className="size-4 animate-spin" /> : "Imagen"}
          </div>
        )}
        <DocInfo doc={doc} processing={processing} />
      </div>
    );
  }

  if (m.type === "audio") {
    return (
      <div className="w-64 space-y-1.5">
        <AudioPlayer url={url} />
        <p className="flex gap-1.5 text-[13px] italic text-ink/80">
          <Mic className="mt-0.5 size-3.5 shrink-0 text-muted" />
          {processing ? "Transcribiendo…" : m.transcription || "Sin transcripción"}
        </p>
      </div>
    );
  }

  if (m.type === "document") {
    return (
      <div className="space-y-2">
        <a
          href={url ?? undefined}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-lg bg-black/5 px-3 py-2 text-sm hover:bg-black/10"
        >
          <FileText className="size-5 text-brand-600" />
          <span className="truncate">{(m.meta?.fileName as string) ?? m.body ?? "Documento"}</span>
        </a>
        <DocInfo doc={doc} processing={processing} />
      </div>
    );
  }
  return null;
}

function DocInfo({ doc, processing }: { doc?: DocumentRow; processing: boolean }) {
  if (processing) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Loader2 className="size-3 animate-spin" /> Verificando con OCR…
      </p>
    );
  }
  if (!doc) return null;
  return (
    <div className="space-y-1 rounded-lg bg-white/70 p-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-medium text-ink">{DOC_TYPES[doc.doc_type ?? "otro"] ?? doc.doc_type}</span>
        <DocStatusBadge status={doc.status} />
      </div>
      {doc.issues.length > 0 && (
        <ul className="list-inside list-disc text-amber-800">
          {doc.issues.slice(0, 3).map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AudioPlayer({ url }: { url: string | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  return (
    <div className="flex items-center gap-2">
      <button
        disabled={!url}
        onClick={() => (playing ? ref.current?.pause() : ref.current?.play())}
        className="flex size-8 items-center justify-center rounded-full bg-brand-600 text-white disabled:opacity-40"
        aria-label={playing ? "Pausar" : "Reproducir"}
      >
        {playing ? <Pause className="size-3.5" /> : <Play className="ml-0.5 size-3.5" />}
      </button>
      <div className="h-1 flex-1 rounded-full bg-black/10">
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${progress}%` }} />
      </div>
      {url && (
        <audio
          ref={ref}
          src={url}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setProgress(0);
          }}
          onTimeUpdate={(e) => setProgress((e.currentTarget.currentTime / (e.currentTarget.duration || 1)) * 100)}
        />
      )}
    </div>
  );
}

const SENDER_LABEL: Record<string, { label: string; icon: typeof Bot }> = {
  ai: { label: "IA", icon: Bot },
  agent: { label: "Asesor", icon: UserRound },
};

function Bubble({ m, doc }: { m: Message; doc?: DocumentRow }) {
  const out = m.direction === "out";
  const sender = SENDER_LABEL[m.sender];
  return (
    <div className={cn("flex", out ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3 py-2 shadow-sm sm:max-w-[70%]",
          out ? "rounded-br-sm bg-brand-100" : "rounded-bl-sm bg-white",
        )}
      >
        {out && sender && (
          <p className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-brand-700">
            <sender.icon className="size-3" /> {sender.label}
          </p>
        )}
        {m.type !== "text" && m.type !== "other" && m.type !== "location" && <MediaContent m={m} doc={doc} />}
        {m.body && m.type !== "document" && <p className="whitespace-pre-wrap text-sm text-ink">{m.body}</p>}
        <p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted">
          {formatTime(m.created_at)}
          {out && (m.status === "read" ? <CheckCheck className="size-3 text-sky-500" /> : m.status === "delivered" ? <CheckCheck className="size-3" /> : <Check className="size-3" />)}
        </p>
      </div>
    </div>
  );
}

/** Montar con `key={lead.id}`: el estado inicial viene de props y luego se mantiene por Realtime. */
export function ChatPanel({
  lead: initialLead,
  initialMessages,
  initialDocs,
  showLeadLink = true,
}: {
  lead: Lead;
  initialMessages: Message[];
  initialDocs: DocumentRow[];
  showLeadLink?: boolean;
}) {
  const [lead, setLead] = useState(initialLead);
  const [messages, setMessages] = useState(initialMessages);
  const [docs, setDocs] = useState(initialDocs);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Tiempo real: mensajes, documentos y cambios del lead
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`chat-${initialLead.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `lead_id=eq.${initialLead.id}` }, (p) => {
        const row = p.new as Message;
        setMessages((prev) => {
          const i = prev.findIndex((m) => m.id === row.id);
          if (i === -1) return [...prev, row];
          const copy = [...prev];
          copy[i] = row;
          return copy;
        });
        // Al terminar el OCR recargamos documentos del lead
        if (p.eventType === "UPDATE") {
          supabase
            .from("documents")
            .select("*")
            .eq("lead_id", initialLead.id)
            .then(({ data }) => data && setDocs(data as DocumentRow[]));
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "leads", filter: `id=eq.${initialLead.id}` }, (p) =>
        setLead((prev) => ({ ...prev, ...(p.new as Lead) })),
      )
      .subscribe();
    markRead(initialLead.id);
    return () => {
      supabase.removeChannel(channel);
    };
  }, [initialLead.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const docsByMessage = useMemo(() => new Map(docs.filter((d) => d.message_id).map((d) => [d.message_id!, d])), [docs]);

  const sorted = useMemo(() => [...messages].sort((a, b) => a.created_at.localeCompare(b.created_at)), [messages]);

  function send() {
    const body = text.trim();
    if (!body) return;
    setError(null);
    startTransition(async () => {
      const r = await sendManualMessage(lead.id, body);
      if (r?.error) setError(r.error);
      else setText("");
    });
  }

  const name = displayName(lead);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-paper px-4 py-3">
        <Avatar name={name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {showLeadLink ? (
              <Link href={`/leads/${lead.id}`} className="truncate font-semibold text-ink hover:underline">
                {name}
              </Link>
            ) : (
              <span className="truncate font-semibold text-ink">{name}</span>
            )}
            <LeadStatusBadge status={lead.status} />
          </div>
          <p className="text-xs text-muted">
            {formatPhone(lead.phone)} · {lead.folio}
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted">
          <Bot className={cn("size-4", lead.ai_enabled ? "text-brand-600" : "text-stone-400")} />
          IA {lead.ai_enabled ? "activa" : "en pausa"}
          <input
            type="checkbox"
            className="peer sr-only"
            checked={lead.ai_enabled}
            onChange={(e) => {
              const enabled = e.target.checked;
              setLead((l) => ({ ...l, ai_enabled: enabled }));
              startTransition(() => setAiEnabled(lead.id, enabled));
            }}
          />
          <span className="relative h-5 w-9 rounded-full bg-stone-300 transition-colors peer-checked:bg-brand-600 after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4" />
        </label>
      </header>

      {lead.needs_human && (
        <div className="flex flex-wrap items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <AlertTriangle className="size-4" />
          <span className="flex-1">
            <b>Requiere asesor:</b> {lead.needs_human_reason}
          </span>
          <Button size="sm" variant="secondary" onClick={() => startTransition(() => resolveHumanRequest(lead.id))}>
            Marcar atendido
          </Button>
        </div>
      )}

      <div className="chat-wallpaper scrollbar-thin min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {sorted.length === 0 && <p className="py-10 text-center text-sm text-muted">Sin mensajes todavía.</p>}
        {sorted.map((m) => (
          <Bubble key={m.id} m={m} doc={docsByMessage.get(m.id)} />
        ))}
        <div ref={bottomRef} />
      </div>

      <footer className="border-t border-line bg-paper p-3">
        {error && <p className="mb-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}
        {lead.ai_enabled && (
          <p className="mb-2 text-xs text-muted">
            La IA está respondiendo. Si escribes tú, considera pausarla para no responder ambos.{" "}
            <button className="font-medium text-brand-600 hover:underline" onClick={() => startTransition(() => triggerAiReply(lead.id))}>
              Pedir respuesta a la IA ahora
            </button>
          </p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={lead.wa_chat_id ? "Escribe un mensaje por WhatsApp…" : "Este prospecto aún no tiene WhatsApp vinculado"}
            disabled={!lead.wa_chat_id}
            className="max-h-40 min-h-10 flex-1 resize-none rounded-xl border border-line bg-cream px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
          <Button onClick={send} disabled={pending || !text.trim()} aria-label="Enviar" className="size-10 px-0">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
      </footer>
    </div>
  );
}
