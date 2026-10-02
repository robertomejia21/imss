"use client";

import { useEffect, useState } from "react";

export function AutoRedirect({ url, seconds }: { url: string; seconds: number }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (left <= 0) {
      window.location.href = url;
      return;
    }
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left, url]);
  return <p className="mt-3 text-xs text-muted">{left > 0 ? `Te llevamos a WhatsApp en ${left}…` : "Abriendo WhatsApp…"}</p>;
}
