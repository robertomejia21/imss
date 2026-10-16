import "server-only";
import { zipSync, strToU8, type Zippable } from "fflate";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DOC_TYPES, DOCUMENT_STATUSES, TRAMITE_STATUSES } from "@/lib/constants";
import { displayName, formatDate, formatPhone } from "@/lib/utils";
import type { DocumentRow, Lead, Profile, Tramite } from "@/lib/types";

/**
 * Expediente de un trámite para el asesor: ZIP con los documentos del prospecto
 * (sin los rechazados) y un datos.txt con su información y la del trámite.
 */

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

const safeName = (s: string) =>
  s
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

const extOf = (d: DocumentRow) => {
  const fromPath = d.storage_path.split("/").pop()?.match(/\.([a-z0-9]{2,5})$/i)?.[1];
  return (fromPath ?? EXT_BY_MIME[d.mime ?? ""] ?? "bin").toLowerCase();
};

const valueText = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

/** Mensaje de WhatsApp para el asesor: quién es, qué trámite y qué esperamos de él. */
export function advisorMessage(lead: Lead, tramite: Tramite, advisor: Pick<Profile, "full_name">, docCount: number) {
  const lines = [
    `📁 *Expediente para revisión* · ${tramite.tipo}`,
    "",
    `Hola ${advisor.full_name ?? ""}, te compartimos el expediente de:`,
    `• *${displayName(lead)}* (${lead.folio})`,
    `• WhatsApp: ${formatPhone(lead.phone)}`,
    lead.curp ? `• CURP: ${lead.curp}` : null,
    lead.nss ? `• NSS: ${lead.nss}` : null,
    `• Fase actual: ${TRAMITE_STATUSES[tramite.status].label}`,
    tramite.notes ? `• Notas: ${tramite.notes}` : null,
    "",
    `En el ZIP van ${docCount} documento${docCount === 1 ? "" : "s"} y el archivo *datos.txt* con toda su información.`,
    "",
    "*¿Qué sigue?* Revisa el expediente y respóndenos por aquí con una de estas:",
    "✅ *Procede*: y qué sigue (folio, fecha o lo que necesites que hagamos)",
    "📄 *Falta algo*: qué documento o dato hay que pedirle",
    "❌ *No procede*: el motivo",
  ];
  return lines.filter((l) => l !== null).join("\n");
}

function datosTxt(lead: Lead, tramite: Tramite, docs: DocumentRow[]) {
  const out: string[] = [];
  const row = (label: string, v: unknown) => {
    if (v !== null && v !== undefined && v !== "") out.push(`${label}: ${valueText(v)}`);
  };

  out.push(`EXPEDIENTE · ${tramite.tipo}`, `Generado: ${formatDate(new Date().toISOString())}`, "");
  out.push("== Prospecto ==");
  row("Nombre", displayName(lead));
  row("Folio", lead.folio);
  row("WhatsApp", formatPhone(lead.phone));
  row("CURP", lead.curp);
  row("NSS", lead.nss);
  row("RFC", lead.rfc);
  row("Correo", lead.email);
  row("Fecha de nacimiento", lead.birth_date);
  row("Notas", lead.notes);

  out.push("", "== Trámite ==");
  row("Producto", tramite.tipo);
  row("Fase", TRAMITE_STATUSES[tramite.status].label);
  row("Folio IMSS", tramite.folio_imss);
  row("Fecha compromiso", tramite.due_date);
  row("Notas", tramite.notes);

  const captured = Object.entries(lead.captured_data ?? {});
  if (captured.length) {
    out.push("", "== Información capturada ==");
    for (const [k, v] of captured) row(k.replaceAll("_", " "), v);
  }

  out.push("", "== Documentos ==");
  if (!docs.length) out.push("(sin documentos)");
  for (const d of docs) {
    out.push(`- ${DOC_TYPES[d.doc_type ?? "otro"] ?? d.doc_type}: ${DOCUMENT_STATUSES[d.status].label}${d.reviewed_at ? " (revisado por asesor)" : ""}`);
    for (const i of d.issues) out.push(`    · ${i}`);
  }
  return out.join("\r\n");
}

/** Arma el ZIP. Los documentos que no se pudieron descargar se anotan en datos.txt en vez de fallar. */
export async function buildExpedienteZip(db: SupabaseClient, lead: Lead, tramite: Tramite) {
  const { data } = await db.from("documents").select("*").eq("lead_id", lead.id).neq("status", "invalido").order("created_at");
  const docs = (data ?? []) as DocumentRow[];

  const files: Zippable = {};
  const used = new Set<string>();
  const failed: string[] = [];
  let n = 0;
  for (const d of docs) {
    const { data: blob, error } = await db.storage.from("media").download(d.storage_path);
    const label = DOC_TYPES[d.doc_type ?? "otro"] ?? d.doc_type ?? "Documento";
    if (error || !blob) {
      failed.push(label);
      continue;
    }
    n++;
    let name = `${String(n).padStart(2, "0")} ${safeName(label)}.${extOf(d)}`;
    while (used.has(name)) name = name.replace(/\.(\w+)$/, " (2).$1");
    used.add(name);
    // Imágenes y PDF ya vienen comprimidos: se guardan tal cual
    files[name] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
  }

  let txt = datosTxt(lead, tramite, docs);
  if (failed.length) txt += `\r\n\r\nNo se pudieron incluir: ${failed.join(", ")}`;
  files["datos.txt"] = strToU8(txt);

  return { zip: zipSync(files), docCount: n, failed };
}
