import "server-only";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { appUrl } from "@/lib/company";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { Lead } from "@/lib/types";

/**
 * Formato "Autorización de consulta y reserva en plataforma Nomi-Pay" (préstamo vía nómina, IMSS-Bienestar).
 * Se llena con los datos del prospecto y el trabajador lo firma con el dedo en /firma/[token].
 */

type Db = ReturnType<typeof createAdminClient>;

const TEMPLATE = path.join(process.cwd(), "src/lib/templates/autorizacion-consulta-nomipay.pdf");
const LINK_DAYS = 7;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export interface AuthorizationData {
  nombre: string | null;
  numeroEmpleadoRfc: string | null;
}

export function authorizationData(lead: Lead): AuthorizationData {
  const num = lead.captured_data?.prestamo_numero_empleado;
  return {
    nombre: lead.full_name?.trim().toUpperCase() || null,
    numeroEmpleadoRfc: (typeof num === "string" && num.trim()) || lead.rfc?.trim().toUpperCase() || null,
  };
}

export const missingAuthorizationFields = (d: AuthorizationData) =>
  [!d.nombre && "nombre completo", !d.numeroEmpleadoRfc && "número de empleado o RFC"].filter((x): x is string => !!x);

const cdmxParts = (d: Date) => {
  const [y, m, day] = d.toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" }).split("-").map(Number);
  return { day: String(day), month: MESES[m! - 1]!, year2: String(y).slice(2) };
};

/**
 * PDF llenado. Coordenadas medidas sobre la plantilla (carta, 612×792; origen abajo a la izquierda).
 * Si viene la firma (PNG), se estampa sobre la línea "Firma del trabajador" con una nota de evidencia al pie.
 */
export async function renderAuthorizationPdf(
  d: AuthorizationData,
  opts: { date?: Date; signaturePng?: Uint8Array; evidence?: string } = {},
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(await readFile(TEMPLATE));
  const page = pdf.getPage(0);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.05, 0.15, 0.45);

  const write = (text: string, x: number, y: number, maxWidth: number, size = 11) => {
    let s = size;
    while (s > 7 && font.widthOfTextAtSize(text, s) > maxWidth) s -= 0.5;
    page.drawText(text, { x, y, size: s, font, color: ink });
  };
  const centered = (text: string, x0: number, x1: number, y: number, size = 11) =>
    page.drawText(text, { x: (x0 + x1) / 2 - font.widthOfTextAtSize(text, size) / 2, y, size, font, color: ink });

  const { day, month, year2 } = cdmxParts(opts.date ?? new Date());
  centered(day, 306, 361, 662);
  centered(month, 377, 476, 662);
  page.drawText(year2, { x: 510.5, y: 662, size: 11, font, color: ink });
  if (d.numeroEmpleadoRfc) write(d.numeroEmpleadoRfc, 246, 325.5, 152);
  if (d.nombre) write(d.nombre, 219, 300, 180);

  if (opts.signaturePng) {
    const img = await pdf.embedPng(opts.signaturePng);
    const h = 26;
    const w = Math.min(180, (img.width / img.height) * h);
    page.drawImage(img, { x: 216 + (184 - w) / 2, y: 271, width: w, height: h });
  }
  if (opts.evidence) page.drawText(opts.evidence, { x: 85, y: 40, size: 7, font, color: rgb(0.4, 0.4, 0.4) });

  pdf.setTitle("Autorización de consulta y reserva en plataforma Nomi-Pay");
  return pdf.save();
}

/** Crea (o renueva) el enlace de firma del prospecto. */
export async function createSigningLink(db: Db, lead: Lead): Promise<string> {
  const token = randomBytes(18).toString("base64url");
  const expira = new Date(Date.now() + LINK_DAYS * 86_400_000).toISOString();
  const captured = { ...lead.captured_data, prestamo_firma: { token, expira } };
  await db.from("leads").update({ captured_data: captured }).eq("id", lead.id);
  lead.captured_data = captured;
  return `${appUrl()}/firma/${token}`;
}

/** Busca el prospecto de un enlace de firma vigente. */
export async function leadBySigningToken(db: Db, token: string): Promise<Lead | null> {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  const { data } = await db.from("leads").select("*").eq("captured_data->prestamo_firma->>token", token).maybeSingle<Lead>();
  const firma = data?.captured_data?.prestamo_firma as { expira?: string } | undefined;
  if (!data || !firma?.expira || new Date(firma.expira).getTime() < Date.now()) return null;
  return data;
}
