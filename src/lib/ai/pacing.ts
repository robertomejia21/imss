/**
 * Ritmo de la conversación por WhatsApp:
 * - esperar a que la persona termine de escribir cuando manda su idea en varios mensajes;
 * - partir la respuesta del agente en varias burbujas cortas, como escribe una persona.
 * Funciones puras (sin BD ni red) para poder probarlas fácilmente.
 */

/** Palabras con las que casi nunca termina una idea: "estoy buscando", "una asesoría para", "quiero saber de". */
const DANGLING_WORDS = new Set([
  "a", "al", "de", "del", "el", "la", "los", "las", "lo", "un", "una", "unos", "unas", "y", "e", "o", "u", "ni",
  "que", "en", "con", "por", "para", "sin", "sobre", "mi", "mis", "tu", "su", "sus", "me", "te", "se", "le", "les",
  "pero", "porque", "como", "cuando", "donde", "pues", "muy", "estoy", "estaba", "quiero", "quisiera", "queria",
  "quería", "busco", "buscando", "necesito", "ocupo", "es", "era", "hay", "saber", "preguntar", "preguntando",
  "acerca", "respecto", "osea", "entonces", "mmm",
]);

/** Saludos que suelen ir seguidos de la pregunta real en otro mensaje. */
const GREETING =
  /^(hola+|holi+s?|buen[oa]s?( (d[ií]as?|tardes?|noches?))?|qu[eé] tal|hey|saludos|ola|bnas|buen d[ií]a)[\s!¡.,👋🏻🙂😊]*$/i;

const strip = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}‍️]/gu, "")
    .trim();

/**
 * Cuánto se ve "a medias" el último mensaje de la persona:
 * - "unfinished": casi seguro sigue escribiendo (saludo solo, termina en "para", "estoy buscando", "...").
 * - "maybe": mensaje corto sin puntuación final ("una asesoria"); puede venir más.
 * - "complete": parece una idea completa (pregunta, oración con punto, mensaje largo).
 */
export function messageCompleteness(body: string | null | undefined): "unfinished" | "maybe" | "complete" {
  const text = strip(body ?? "");
  if (!text) return "complete";
  if (/(\.\.\.|…|,)$/.test(text)) return "unfinished";
  if (GREETING.test(text)) return "unfinished";
  if (/[?.!]$/.test(text)) return "complete";
  const words = text.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const last = words[words.length - 1] ?? "";
  if (DANGLING_WORDS.has(last)) return "unfinished";
  if (words.length === 1) return "complete"; // "si", "no", "ok", "1": respuesta a una pregunta
  if (words.length <= 4) return "maybe";
  return "complete";
}

/** Segundos extra que se esperan, además de la espera configurada, según qué tan incompleto se ve el mensaje. */
export function extraWaitSeconds(body: string | null | undefined) {
  const c = messageCompleteness(body);
  return c === "unfinished" ? 12 : c === "maybe" ? 5 : 0;
}

const MAX_PARTS = 4;
const isListLine = (line: string) => /^\s*([-•*▪️✅📌]|\d+[.)️⃣]|[a-z]\))\s*/iu.test(line);

/**
 * Parte una respuesta en burbujas de WhatsApp.
 * Corta en las líneas en blanco, pero mantiene juntos un listado y la frase que lo presenta
 * (la que termina en ":"), y nunca manda más de 4 burbujas.
 */
export function splitReply(text: string): string[] {
  const blocks = text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const parts: string[] = [];
  for (const block of blocks) {
    const prev = parts[parts.length - 1];
    const firstLine = block.split("\n")[0];
    const prevLastLine = prev?.split("\n").at(-1) ?? "";
    // La frase que presenta un listado y el listado van en la misma burbuja; también los listados partidos en dos
    if (prev !== undefined && isListLine(firstLine) && (prevLastLine.trim().endsWith(":") || isListLine(prevLastLine))) {
      parts[parts.length - 1] = `${prev}\n${block}`;
    } else {
      parts.push(block);
    }
  }

  // Burbujas muy cortas ("¡Perfecto!") se juntan con la siguiente para no saturar el chat
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i].length < 25 && !parts[i].trim().endsWith(":")) {
      const glue = isListLine(parts[i + 1].split("\n")[0]) ? "\n" : " ";
      parts.splice(i, 2, `${parts[i]}${glue}${parts[i + 1]}`);
      i--;
    }
  }

  // Máximo de burbujas: se une el par contiguo más corto
  while (parts.length > MAX_PARTS) {
    let best = 0;
    for (let i = 1; i < parts.length - 1; i++) {
      if (parts[i].length + parts[i + 1].length < parts[best].length + parts[best + 1].length) best = i;
    }
    parts.splice(best, 2, `${parts[best]}\n\n${parts[best + 1]}`);
  }
  return parts.length ? parts : [text.trim()];
}

/** Pausa con "escribiendo…" antes de cada burbuja, proporcional a su largo (1.2 s a 4 s). */
export const typingMsFor = (part: string) => Math.min(4000, 1200 + part.length * 18);
