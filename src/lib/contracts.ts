import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lead, Profile } from "@/lib/types";

/**
 * Contrato de retiro por desempleo (plantilla en src/lib/templates).
 * La plantilla no tiene campos de formulario: el texto se escribe sobre las líneas en blanco.
 * Las coordenadas (en puntos, origen arriba-izquierda) se midieron sobre la plantilla.
 */
const TEMPLATE = path.join(process.cwd(), "src/lib/templates/contrato-retiro-desempleo.pdf");

export const DESEMPLEO_FEE_TEXT = "$7,000.00 (SIETE MIL PESOS 00/100 M.N.)";

const MONTHS = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];

export interface ContractData {
  beneficiario: string | null; // el cliente
  domicilio: string | null;
  afore: string | null;
  nss: string | null;
  claveElector: string | null;
  profesionista: string | null; // el asesor asignado (quien recibe el pago)
  asesorCiudad: string | null;
  asesorEstado: string | null;
  asesorPhone: string | null;
}

export const CONTRACT_FIELD_LABELS: Record<keyof ContractData, string> = {
  beneficiario: "Nombre completo del cliente",
  domicilio: "Domicilio del cliente (viene en el frente de la INE)",
  afore: "AFORE donde tiene su cuenta",
  nss: "NSS",
  claveElector: "Clave de elector / folio de la INE",
  profesionista: "Asesor asignado (con nombre)",
  asesorCiudad: "Ciudad del asesor asignado",
  asesorEstado: "Estado del asesor asignado",
  asesorPhone: "WhatsApp del asesor asignado",
};

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Junta los datos del contrato desde el lead, sus documentos (INE) y el asesor asignado. */
export async function getContractData(db: SupabaseClient, lead: Lead): Promise<ContractData> {
  const extra = { ...lead.form_data, ...lead.captured_data } as Record<string, unknown>;

  const { data: ines } = await db
    .from("documents")
    .select("extracted")
    .eq("lead_id", lead.id)
    .eq("doc_type", "ine")
    .in("status", ["valido", "con_observaciones"])
    .order("created_at", { ascending: false });
  const fromIne = (k: string) =>
    ((ines ?? []) as { extracted: Record<string, unknown> }[]).map((d) => text(d.extracted?.[k])).find(Boolean) ?? null;

  let asesor: Pick<Profile, "full_name" | "phone" | "city" | "state"> | null = null;
  if (lead.assigned_to) {
    const { data } = await db.from("profiles").select("full_name, phone, city, state").eq("id", lead.assigned_to).maybeSingle();
    asesor = data;
  }

  return {
    beneficiario: text(lead.full_name),
    domicilio: text(extra.domicilio) ?? fromIne("domicilio"),
    afore: text(extra.afore),
    nss: text(lead.nss),
    claveElector: text(extra.clave_elector) ?? fromIne("clave_elector"),
    profesionista: text(asesor?.full_name),
    asesorCiudad: text(asesor?.city),
    asesorEstado: text(asesor?.state),
    asesorPhone: text(asesor?.phone),
  };
}

export const missingContractFields = (d: ContractData) =>
  (Object.keys(CONTRACT_FIELD_LABELS) as (keyof ContractData)[]).filter((k) => !d[k]).map((k) => CONTRACT_FIELD_LABELS[k]);

export async function renderDesempleoContract(d: ContractData, date = new Date()): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(await readFile(TEMPLATE));
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const [p1, p2] = pdf.getPages();
  const H = p1!.getSize().height;

  // Fecha en Los Mochis, Sinaloa
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Mazatlan", day: "numeric", month: "numeric", year: "numeric" })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const day = parts.day!;
  const month = MONTHS[Number(parts.month) - 1]!;
  const year = parts.year!;

  /** Escribe `value` sobre la línea [x0, x1] cuya posición vertical es `lineTop` (desde arriba). */
  const put = (page: PDFPage, value: string | null, x0: number, x1: number, lineTop: number, opts: { size?: number; f?: PDFFont; center?: boolean; plain?: boolean } = {}) => {
    if (!value) return;
    const f = opts.f ?? font;
    const width = x1 - x0 - 4;
    let size = opts.size ?? 10;
    while (size > 6 && f.widthOfTextAtSize(value, size) > width) size -= 0.5;
    const w = f.widthOfTextAtSize(value, size);
    const x = opts.center ? x0 + (x1 - x0 - w) / 2 : x0 + 2;
    // `plain`: reemplaza texto impreso de la plantilla (negro, sobre la línea base) en vez de llenar una línea en blanco
    page.drawText(value, { x, y: H - lineTop + (opts.plain ? 0 : 2), size, font: f, color: opts.plain ? rgb(0, 0, 0) : rgb(0.05, 0.1, 0.35) });
  };

  const up = (s: string | null) => s?.toUpperCase() ?? null;
  const cliente = up(d.beneficiario);
  const asesor = up(d.profesionista);

  // Página 1
  put(p1!, day, 131.3, 162.5, 107.7, { center: true });
  put(p1!, month, 175.9, 281.7, 107.7, { center: true });
  put(p1!, year, 301.6, 357.4, 107.7, { center: true });
  put(p1!, cliente, 252.5, 526.7, 119.2, { f: bold });
  put(p1!, asesor, 79.9, 342.6, 142.3, { f: bold });
  put(p1!, cliente, 252.2, 521.4, 193.5, { size: 11 });
  put(p1!, up(d.domicilio), 79.9, 519.8, 223.7);
  put(p1!, up(d.afore), 365.4, 467.6, 269.0, { f: bold, center: true });
  put(p1!, d.nss, 141.6, 254.4, 280.4, { f: bold, center: true });
  put(p1!, up(d.claveElector), 121.0, 281.2, 349.2, { center: true });
  put(p1!, asesor, 260.8, 525.7, 384.0, { f: bold });
  // II.b: la plantilla trae "LOS MOCHIS, AHOME, SINALOA." como domicilio del profesionista; se cubre y se escribe el del asesor
  if (d.asesorCiudad && d.asesorEstado) {
    p1!.drawRectangle({ x: 252.5, y: H - 456.5, width: 160, height: 12.5, color: rgb(1, 1, 1) });
    put(p1!, `${up(d.asesorCiudad)}, ${up(d.asesorEstado)}.`, 251.7, 530, 453.4, { size: 9.5, plain: true });
  }

  // Página 2
  put(p2!, DESEMPLEO_FEE_TEXT, 259.9, 525.2, 138.3, { size: 9, f: bold });
  put(p2!, day, 462.1, 507.9, 508.6, { center: true });
  put(p2!, month, 79.9, 203.3, 519.2, { center: true });
  put(p2!, year, 224.1, 285.3, 519.2, { center: true });
  put(p2!, cliente, 103.2, 269.5, 598.2, { size: 9, center: true });
  put(p2!, asesor, 329.1, 495.6, 598.2, { size: 9, center: true });

  pdf.setTitle(`Contrato retiro por desempleo - ${d.beneficiario ?? ""}`);
  return pdf.save();
}
