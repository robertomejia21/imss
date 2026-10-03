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

/** Abreviaturas para los estados que no caben en el renglón 2 del encabezado. */
const STATE_ABBR: Record<string, string> = {
  AGUASCALIENTES: "AGS.",
  "BAJA CALIFORNIA": "B.C.",
  "BAJA CALIFORNIA SUR": "B.C.S.",
  CAMPECHE: "CAMP.",
  CHIAPAS: "CHIS.",
  CHIHUAHUA: "CHIH.",
  "CIUDAD DE MÉXICO": "CDMX",
  "CIUDAD DE MEXICO": "CDMX",
  COAHUILA: "COAH.",
  COLIMA: "COL.",
  DURANGO: "DGO.",
  "ESTADO DE MÉXICO": "EDOMEX",
  "ESTADO DE MEXICO": "EDOMEX",
  GUANAJUATO: "GTO.",
  GUERRERO: "GRO.",
  HIDALGO: "HGO.",
  JALISCO: "JAL.",
  MICHOACÁN: "MICH.",
  MICHOACAN: "MICH.",
  MORELOS: "MOR.",
  NAYARIT: "NAY.",
  "NUEVO LEÓN": "N.L.",
  "NUEVO LEON": "N.L.",
  OAXACA: "OAX.",
  PUEBLA: "PUE.",
  QUERÉTARO: "QRO.",
  QUERETARO: "QRO.",
  "QUINTANA ROO": "Q. ROO",
  "SAN LUIS POTOSÍ": "S.L.P.",
  "SAN LUIS POTOSI": "S.L.P.",
  SINALOA: "SIN.",
  SONORA: "SON.",
  TABASCO: "TAB.",
  TAMAULIPAS: "TAMPS.",
  TLAXCALA: "TLAX.",
  VERACRUZ: "VER.",
  YUCATÁN: "YUC.",
  YUCATAN: "YUC.",
  ZACATECAS: "ZAC.",
};

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
  const put = (page: PDFPage, value: string | null, x0: number, x1: number, lineTop: number, opts: { size?: number; f?: PDFFont; center?: boolean } = {}) => {
    if (!value) return;
    const f = opts.f ?? font;
    const width = x1 - x0 - 4;
    let size = opts.size ?? 10;
    while (size > 6 && f.widthOfTextAtSize(value, size) > width) size -= 0.5;
    const w = f.widthOfTextAtSize(value, size);
    const x = opts.center ? x0 + (x1 - x0 - w) / 2 : x0 + 2;
    page.drawText(value, { x, y: H - lineTop + 2, size, font: f, color: rgb(0.05, 0.1, 0.35) });
  };

  /**
   * Reemplaza texto impreso de la plantilla: cubre [x0, x1] en la línea base `baseline` y escribe los segmentos
   * (texto + fuente) en negro, reduciendo el tamaño lo necesario para que quepan. Con `justify`, reparte el
   * espacio sobrante entre las palabras para llenar el renglón, como el texto justificado de la plantilla.
   */
  const replace = (page: PDFPage, segments: [string, PDFFont][], x0: number, x1: number, baseline: number, size: number, justify = false) => {
    page.drawRectangle({ x: x0 - 0.5, y: H - baseline - 2.6, width: x1 - x0 + 1, height: size + 2, color: rgb(1, 1, 1) });
    const words = segments.flatMap(([t, f]) => t.split(" ").filter(Boolean).map((w) => [w, f] as const));
    const wordsWidth = (sz: number) => words.reduce((w, [t, f]) => w + f.widthOfTextAtSize(t, sz), 0);
    const gaps = Math.max(words.length - 1, 1);
    let sz = size;
    while (sz > 6 && wordsWidth(sz) + gaps * font.widthOfTextAtSize(" ", sz) > x1 - x0) sz -= 0.25;
    const space = justify ? (x1 - x0 - wordsWidth(sz)) / gaps : font.widthOfTextAtSize(" ", sz);
    let x = x0;
    for (const [t, f] of words) {
      page.drawText(t, { x, y: H - baseline, size: sz, font: f, color: rgb(0, 0, 0) });
      x += f.widthOfTextAtSize(t, sz) + space;
    }
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

  // La plantilla trae "LOS MOCHIS, AHOME, SINALOA" como ciudad del contrato y domicilio del profesionista;
  // se reemplaza en los 3 lugares por la ciudad y el estado del asesor.
  const ciudad = up(d.asesorCiudad);
  const estado = up(d.asesorEstado);
  if (ciudad && estado) {
    // Encabezado, renglón 1: "CONTRATO DE PRESTACION DE SERVICIOS QUE CELEBRAN EN LA CIUDAD DE LOS MOCHIS,"
    replace(p1!, [["CONTRATO DE PRESTACION DE SERVICIOS", bold], [`QUE CELEBRAN EN LA CIUDAD DE ${ciudad},`, font]], 79.9, 526.6, 95.1, 9.96, true);
    // Encabezado, renglón 2: "AHOME, A __ DE __" (poco espacio antes del día: estados largos van abreviados)
    const estadoCorto = font.widthOfTextAtSize(`${estado}, A`, 8.5) > 50.6 ? (STATE_ABBR[estado] ?? estado) : estado;
    replace(p1!, [[`${estadoCorto}, A`, font]], 79.9, 128.7, 106.6, 9.96, true);
    // II.b: domicilio del profesionista
    replace(p1!, [[`${ciudad}, ${estado}.`, font]], 253.7, 530, 453.4, 9.5);
    // Firmas: "FIRMANDOSE POR DUPLICADO EN LA CIUDAD DE LOS MOCHIS, SINALOA A __"
    replace(p2!, [[`FIRMANDOSE POR DUPLICADO EN LA CIUDAD DE ${ciudad}, ${estado} A`, bold]], 79.9, 456, 507.7, 9, true);
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
