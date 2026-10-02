"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** Refresca la página (Server Components) cuando cambian tablas de Supabase. */
export function RealtimeRefresh({ tables, channel }: { tables: string[]; channel: string }) {
  const router = useRouter();
  const key = tables.join(",");
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 400);
    };
    let ch = supabase.channel(channel);
    for (const table of key.split(",")) ch = ch.on("postgres_changes", { event: "*", schema: "public", table }, refresh);
    ch.subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(ch);
    };
  }, [router, channel, key]);
  return null;
}
