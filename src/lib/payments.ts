import "server-only";
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { digits } from "@/lib/utils";
import type { Lead } from "@/lib/types";

/**
 * Datos de pago de los honorarios. Los valores por defecto son FICTICIOS:
 * define los reales con variables de entorno antes de salir a producción.
 */
export const PAYMENT = {
  businessName: process.env.PAYMENT_BUSINESS_NAME ?? "García Asesores",
  beneficiary: process.env.PAYMENT_BENEFICIARY ?? "GARCÍA ASESORES",
  bank: process.env.PAYMENT_BANK ?? "BANCO DE PRUEBA S.A.",
  account: process.env.PAYMENT_ACCOUNT ?? "0000000000",
  clabe: process.env.PAYMENT_CLABE ?? "000000000000000000",
  amount: Number(process.env.PAYMENT_AMOUNT ?? 1500),
  validHours: Number(process.env.PAYMENT_VALID_HOURS ?? 72),
  concept: process.env.PAYMENT_CONCEPT ?? "Honorarios asesoría Alta IMSS",
};

export const isPaymentConfigFictitious = () => !process.env.PAYMENT_CLABE;

export const formatMxn = (n: number) =>
  n.toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 });

const groupDigits = (s: string, size = 4) => digits(s).replace(new RegExp(`(\\d{${size}})(?=\\d)`, "g"), "$1 ");

const cdmx = (d: Date, opts: Intl.DateTimeFormatOptions) =>
  d.toLocaleString("es-MX", { timeZone: "America/Mexico_City", ...opts });

/** Fecha YYYY-MM-DD en horario de CDMX. */
export const cdmxDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });

export interface PaymentSlip {
  reference: string;
  amount: number;
  issuedAt: Date;
  expiresAt: Date;
}

export function buildSlip(lead: Lead, issuedAt = new Date()): PaymentSlip {
  return {
    reference: lead.folio,
    amount: PAYMENT.amount,
    issuedAt,
    expiresAt: new Date(issuedAt.getTime() + PAYMENT.validHours * 3600_000),
  };
}

// =============================================================
// PDF de la ficha de pago
// =============================================================

const GREEN = rgb(0.05, 0.35, 0.27);
const INK = rgb(0.11, 0.12, 0.13);
const MUTED = rgb(0.42, 0.44, 0.46);
const LINE = rgb(0.85, 0.86, 0.87);
const TINT = rgb(0.94, 0.97, 0.95);

function wrap(text: string, font: PDFFont, size: number, maxWidth: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderPaymentSlipPdf(lead: Lead, slip: PaymentSlip): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Ficha de pago ${slip.reference}`);
  pdf.setAuthor(PAYMENT.businessName);
  pdf.setSubject(PAYMENT.concept);

  const page: PDFPage = pdf.addPage([612, 792]); // carta
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();
  const M = 48;
  const W = width - M * 2;

  const text = (t: string, x: number, y: number, size = 10, font = regular, color = INK) =>
    page.drawText(t, { x, y, size, font, color });
  const right = (t: string, xRight: number, y: number, size = 10, font = regular, color = INK) =>
    text(t, xRight - font.widthOfTextAtSize(t, size), y, size, font, color);

  // Encabezado
  page.drawRectangle({ x: 0, y: height - 96, width, height: 96, color: GREEN });
  text(PAYMENT.businessName.toUpperCase(), M, height - 50, 20, bold, rgb(1, 1, 1));
  text("Asesoría independiente en Seguridad Social", M, height - 70, 10, regular, rgb(0.85, 0.93, 0.89));
  right("FICHA DE PAGO", width - M, height - 50, 14, bold, rgb(1, 1, 1));
  right(`Folio ${slip.reference}`, width - M, height - 70, 10, regular, rgb(0.85, 0.93, 0.89));

  let y = height - 132;
  const dateOpts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" };
  text("Fecha de emisión", M, y, 9, regular, MUTED);
  text("Vigente hasta", M + W / 2, y, 9, regular, MUTED);
  y -= 14;
  text(cdmx(slip.issuedAt, dateOpts), M, y, 11, bold);
  text(cdmx(slip.expiresAt, dateOpts), M + W / 2, y, 11, bold);

  // Cliente
  y -= 34;
  text("DATOS DEL CLIENTE", M, y, 9, bold, GREEN);
  y -= 8;
  page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.8, color: LINE });
  const rows: [string, string][] = [
    ["Nombre", lead.full_name ?? lead.wa_name ?? "—"],
    ["CURP", lead.curp ?? "—"],
    ["Servicio", PAYMENT.concept],
  ];
  for (const [k, v] of rows) {
    y -= 20;
    text(k, M, y, 10, regular, MUTED);
    text(v, M + 110, y, 11, bold);
  }

  // Importe
  y -= 40;
  const boxH = 70;
  page.drawRectangle({ x: M, y: y - boxH + 18, width: W, height: boxH, color: TINT, borderColor: GREEN, borderWidth: 1 });
  text("TOTAL A PAGAR", M + 18, y - 6, 10, bold, GREEN);
  text("Pago único · Moneda nacional", M + 18, y - 24, 9, regular, MUTED);
  right(`${formatMxn(slip.amount)} MXN`, M + W - 18, y - 20, 24, bold, GREEN);
  y -= boxH + 10;

  // Datos bancarios
  y -= 18;
  text("DATOS PARA TRANSFERENCIA O DEPÓSITO", M, y, 9, bold, GREEN);
  y -= 8;
  page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.8, color: LINE });
  const bankRows: [string, string][] = [
    ["Beneficiario", PAYMENT.beneficiary],
    ["Banco", PAYMENT.bank],
    ["Número de cuenta", groupDigits(PAYMENT.account)],
    ["CLABE interbancaria", groupDigits(PAYMENT.clabe, 3)],
    ["Referencia / concepto", slip.reference],
  ];
  for (const [k, v] of bankRows) {
    y -= 22;
    text(k, M, y, 10, regular, MUTED);
    text(v, M + 150, y, 12, bold);
  }

  // Instrucciones
  y -= 36;
  text("INSTRUCCIONES", M, y, 9, bold, GREEN);
  y -= 8;
  page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.8, color: LINE });
  const steps = [
    `Realiza el pago por ${formatMxn(slip.amount)} antes de la fecha de vigencia.`,
    `Escribe tu folio ${slip.reference} en el concepto o referencia de la transferencia.`,
    "Envía foto o captura de tu comprobante por WhatsApp a tu asesora.",
    "Paga únicamente a la cuenta indicada en esta ficha. Nunca te pediremos depositar a una persona ni compartir contraseñas, NIP o códigos.",
  ];
  steps.forEach((s, i) => {
    const lines = wrap(s, regular, 10, W - 24);
    y -= 18;
    text(`${i + 1}.`, M, y, 10, bold, GREEN);
    lines.forEach((l, j) => text(l, M + 18, y - j * 13, 10));
    y -= (lines.length - 1) * 13;
  });

  // Aviso legal
  const legal =
    `${PAYMENT.businessName} es un despacho independiente de asesoría; no es el Instituto Mexicano del Seguro Social (IMSS) ni actúa en su nombre. ` +
    "Este pago corresponde exclusivamente a honorarios por servicios de asesoría y gestión. La cuota de seguridad social se paga directamente al IMSS " +
    "mediante línea de captura a nombre del asegurado. Los trámites ante el IMSS son gratuitos y pueden realizarse personalmente.";
  const legalLines = wrap(legal, regular, 8, W);
  let ly = 48 + legalLines.length * 11;
  page.drawLine({ start: { x: M, y: ly + 10 }, end: { x: M + W, y: ly + 10 }, thickness: 0.8, color: LINE });
  for (const l of legalLines) {
    text(l, M, ly, 8, regular, MUTED);
    ly -= 11;
  }
  if (isPaymentConfigFictitious()) {
    page.drawText("DOCUMENTO DE PRUEBA · CUENTA FICTICIA", {
      x: 70, y: 250, size: 24, font: bold, color: rgb(0.85, 0.2, 0.2), opacity: 0.18, rotate: degrees(30),
    });
  }

  return pdf.save();
}

// =============================================================
// Validación de comprobantes de pago (OCR)
// =============================================================

export interface PaymentReceipt {
  monto: number | null;
  fecha_operacion: string | null;
  banco_emisor: string | null;
  banco_destino: string | null;
  beneficiario: string | null;
  cuenta_destino: string | null;
  clave_rastreo: string | null;
  folio_operacion: string | null;
  concepto: string | null;
  referencia: string | null;
  ordenante: string | null;
}

/** Reglas de la sección 7 del prompt de Aurora. Devuelve observaciones (vacío = coincide). */
export function evaluatePaymentReceipt(
  pago: PaymentReceipt | null,
  lead: { folio: string; captured_data: Record<string, unknown> },
): string[] {
  if (!pago) return ["No se pudieron leer los datos del comprobante de pago"];
  const issues: string[] = [];
  const data = lead.captured_data ?? {};
  const expected = Number(data.pago_monto_esperado ?? PAYMENT.amount);

  if (pago.monto == null) issues.push("No se pudo leer el monto del comprobante");
  else if (Math.abs(pago.monto - expected) > 0.009)
    issues.push(`El monto del comprobante (${formatMxn(pago.monto)}) no coincide con el esperado (${formatMxn(expected)})`);

  const dest = digits(pago.cuenta_destino ?? "");
  const last4 = dest.slice(-4);
  if (!last4) issues.push("No se pudo leer la cuenta o CLABE destino");
  else if (![PAYMENT.clabe, PAYMENT.account].some((acc) => digits(acc).endsWith(last4)))
    issues.push(`La cuenta destino (terminación ${last4}) no corresponde a la cuenta de ${PAYMENT.businessName}`);

  if (!pago.clave_rastreo && !pago.folio_operacion) issues.push("El comprobante no muestra clave de rastreo ni folio de operación");

  const slipDate = typeof data.pago_ficha_fecha === "string" ? data.pago_ficha_fecha.slice(0, 10) : null;
  if (!slipDate) issues.push("A este prospecto todavía no se le había enviado ficha de pago");
  if (!pago.fecha_operacion) issues.push("No se pudo leer la fecha de la operación");
  else if (slipDate && pago.fecha_operacion.slice(0, 10) < slipDate)
    issues.push(`La fecha del pago (${pago.fecha_operacion}) es anterior a la ficha (${slipDate})`);

  const ref = `${pago.concepto ?? ""} ${pago.referencia ?? ""}`.toUpperCase();
  if (!ref.includes(lead.folio.toUpperCase())) issues.push(`Observación menor: el concepto no incluye el folio ${lead.folio}`);

  return issues;
}

/** Las observaciones "menores" no impiden dar el comprobante por válido. */
export const isMinorIssue = (issue: string) => issue.startsWith("Observación menor");
