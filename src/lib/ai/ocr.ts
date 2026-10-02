import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { anthropic, FALLBACK_BETA, MODEL } from "./anthropic";
import { isValidCurp, isValidNss } from "@/lib/utils";
import { evaluatePaymentReceipt, formatMxn, isMinorIssue } from "@/lib/payments";
import type { DocumentStatus } from "@/lib/types";

const DocTypeEnum = z.enum([
  "ine",
  "curp",
  "nss",
  "comprobante_domicilio",
  "acta_nacimiento",
  "estado_cuenta",
  "constancia_semanas",
  "rfc",
  "comprobante_pago",
  "otro",
]);

const PagoSchema = z.object({
  monto: z.number().nullable().describe("Importe pagado en pesos, solo número (ej. 1500.00)"),
  fecha_operacion: z.string().nullable().describe("Fecha de la operación, formato YYYY-MM-DD"),
  banco_emisor: z.string().nullable().describe("Banco desde el que se pagó"),
  banco_destino: z.string().nullable(),
  beneficiario: z.string().nullable().describe("Nombre del beneficiario o destinatario"),
  cuenta_destino: z.string().nullable().describe("Cuenta, CLABE o tarjeta destino tal como aparece (puede venir enmascarada, ej. ****1234)"),
  clave_rastreo: z.string().nullable().describe("Clave de rastreo SPEI"),
  folio_operacion: z.string().nullable().describe("Folio, número de autorización o referencia numérica del banco"),
  concepto: z.string().nullable().describe("Concepto o motivo del pago"),
  referencia: z.string().nullable().describe("Referencia escrita por el cliente"),
  ordenante: z.string().nullable().describe("Nombre de quien pagó"),
});

export const OcrSchema = z.object({
  tipo_documento: DocTypeEnum,
  descripcion: z.string().describe("Descripción breve de qué es el documento"),
  legible: z.boolean().describe("¿Se puede leer con claridad la información principal?"),
  es_documento_oficial: z.boolean().describe("¿Parece un documento oficial mexicano o un comprobante bancario auténtico (no una captura de otro chat, meme o foto ajena)?"),
  posible_alteracion: z.boolean().describe("¿Hay señales de edición, recortes o alteraciones?"),
  documento_completo: z.boolean().describe("¿Se ve el documento completo (sin bordes cortados)?"),
  lado: z.enum(["frente", "reverso", "ambos", "no_aplica"]),
  nombre_completo: z.string().nullable(),
  curp: z.string().nullable(),
  nss: z.string().nullable(),
  rfc: z.string().nullable(),
  clave_elector: z.string().nullable(),
  fecha_nacimiento: z.string().nullable().describe("Formato YYYY-MM-DD"),
  sexo: z.string().nullable(),
  domicilio: z.string().nullable(),
  codigo_postal: z.string().nullable(),
  fecha_emision: z.string().nullable().describe("Formato YYYY-MM-DD si se conoce"),
  vigencia: z.string().nullable().describe("Año o fecha de vigencia tal como aparece"),
  pago: PagoSchema.nullable().describe("Solo para comprobantes de pago o transferencia; null en cualquier otro documento"),
  otros_datos: z.array(z.object({ campo: z.string(), valor: z.string() })),
  observaciones: z.array(z.string()).describe("Problemas detectados, en español, dirigidos al asesor"),
  confianza: z.number().describe("0 a 1: confianza general de la extracción"),
});

export type OcrResult = z.infer<typeof OcrSchema>;

const OCR_PROMPT = `Eres un verificador de documentos para trámites del IMSS en México.
Analiza el documento adjunto y extrae sus datos con precisión, carácter por carácter.
- Transcribe CURP, NSS, RFC y clave de elector exactamente como aparecen (mayúsculas, sin espacios).
- Si un dato no aparece o no se puede leer, usa null. Nunca inventes datos.
- Para INE/credencial, indica si la foto muestra el frente, el reverso o ambos, y la vigencia.
- Si es un comprobante de pago, transferencia (SPEI), depósito o ticket bancario: tipo_documento = "comprobante_pago", llena "pago" con monto, fecha, cuentas, clave de rastreo, concepto y ordenante, y deja nombre_completo, curp y nss en null. Revisa con cuidado señales de edición (tipografías distintas, cifras desalineadas, recortes).
- En "observaciones" anota problemas útiles para el asesor: foto borrosa, reflejos, documento vencido, recortado, datos ilegibles, posibles alteraciones, etc.`;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImageMime = (typeof IMAGE_TYPES)[number];

export const isOcrSupported = (mime: string) =>
  (IMAGE_TYPES as readonly string[]).includes(mime) || mime === "application/pdf";

export async function extractDocument(file: Buffer, mime: string): Promise<OcrResult> {
  const data = file.toString("base64");
  const source: Anthropic.Beta.BetaContentBlockParam =
    mime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: mime as ImageMime, data } };

  const response = await anthropic.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(OcrSchema) },
    messages: [{ role: "user", content: [source, { type: "text", text: OCR_PROMPT }] }],
  });

  if (response.stop_reason === "refusal") throw new Error("El modelo no pudo procesar este documento");
  if (!response.parsed_output) throw new Error("No se pudo interpretar el resultado del OCR");
  return response.parsed_output;
}

/** Reglas de negocio sobre el resultado del OCR → estado del documento + observaciones. */
export function evaluateDocument(
  ocr: OcrResult,
  lead: { folio: string; full_name: string | null; curp: string | null; nss: string | null; captured_data: Record<string, unknown> },
): { status: DocumentStatus; issues: string[] } {
  if (ocr.tipo_documento === "comprobante_pago") return evaluateReceipt(ocr, lead);
  const issues = [...ocr.observaciones];

  if (!ocr.legible) issues.push("El documento no es legible");
  if (!ocr.es_documento_oficial) issues.push("No parece un documento oficial");
  if (ocr.posible_alteracion) issues.push("Posible alteración del documento");
  if (!ocr.documento_completo) issues.push("El documento aparece recortado o incompleto");

  if (ocr.curp && !isValidCurp(ocr.curp)) issues.push(`La CURP leída (${ocr.curp}) no tiene un formato válido`);
  if (ocr.nss && !isValidNss(ocr.nss)) issues.push(`El NSS leído (${ocr.nss}) no es válido (11 dígitos con verificador)`);

  if (ocr.curp && lead.curp && ocr.curp.toUpperCase() !== lead.curp.toUpperCase())
    issues.push(`La CURP del documento no coincide con la registrada (${lead.curp})`);
  if (ocr.nss && lead.nss && ocr.nss.replace(/\D/g, "") !== lead.nss.replace(/\D/g, ""))
    issues.push(`El NSS del documento no coincide con el registrado (${lead.nss})`);
  if (ocr.nombre_completo && lead.full_name && !namesMatch(ocr.nombre_completo, lead.full_name))
    issues.push(`El nombre del documento (${ocr.nombre_completo}) no coincide con el registrado (${lead.full_name})`);

  if (ocr.tipo_documento === "ine" && ocr.vigencia) {
    const year = Number(ocr.vigencia.match(/\d{4}/g)?.pop());
    if (year && year < new Date().getFullYear()) issues.push(`La identificación está vencida (vigencia ${ocr.vigencia})`);
  }

  const status: DocumentStatus =
    !ocr.legible || !ocr.es_documento_oficial
      ? "invalido"
      : issues.length > 0 || ocr.confianza < 0.7
        ? "con_observaciones"
        : "valido";

  return { status, issues: [...new Set(issues)] };
}

function evaluateReceipt(
  ocr: OcrResult,
  lead: { folio: string; captured_data: Record<string, unknown> },
): { status: DocumentStatus; issues: string[] } {
  const ruleIssues = evaluatePaymentReceipt(ocr.pago, lead);
  const blocking = ruleIssues.filter((i) => !isMinorIssue(i));
  if (!ocr.legible) blocking.push("El comprobante no es legible");
  if (!ocr.es_documento_oficial) blocking.push("No parece un comprobante bancario auténtico");
  if (ocr.posible_alteracion) blocking.push("Posible alteración del comprobante");
  if (!ocr.documento_completo) blocking.push("El comprobante aparece recortado o incompleto");
  if (ocr.confianza < 0.7) blocking.push("Lectura con baja confianza");

  const issues = [...new Set([...blocking, ...ruleIssues.filter(isMinorIssue), ...ocr.observaciones])];
  const status: DocumentStatus = !ocr.legible
    ? "invalido"
    : blocking.length > 0
      ? "con_observaciones"
      : "valido";
  return { status, issues };
}

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);

/** Coincidencia flexible: al menos 2 palabras en común (nombres en distinto orden). */
function namesMatch(a: string, b: string) {
  const wa = new Set(normalize(a));
  const common = normalize(b).filter((w) => wa.has(w)).length;
  return common >= Math.min(2, wa.size);
}

/** Resumen corto en texto para que el agente conversacional sepa qué se recibió. */
export function ocrSummaryForAgent(ocr: OcrResult, status: DocumentStatus, issues: string[]) {
  if (ocr.tipo_documento === "comprobante_pago") {
    const p = ocr.pago;
    const fields = [
      ["Monto", p?.monto != null ? formatMxn(p.monto) : null],
      ["Fecha", p?.fecha_operacion],
      ["Banco emisor", p?.banco_emisor],
      ["Cuenta destino", p?.cuenta_destino],
      ["Beneficiario", p?.beneficiario],
      ["Clave de rastreo", p?.clave_rastreo],
      ["Folio", p?.folio_operacion],
      ["Concepto", p?.concepto],
      ["Ordenante", p?.ordenante],
    ]
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join("; ");
    const verdict =
      status === "valido"
        ? "PREVALIDACIÓN DEL PAGO: el comprobante coincide con la ficha (pago_estado ya quedó como comprobante_valido). Agradece, confirma y usa solicitar_asesor_humano para la conciliación y el alta."
        : "PREVALIDACIÓN DEL PAGO: NO se puede dar por válido (pago_estado ya quedó como comprobante_en_revision). Pide con amabilidad lo que falte o, si hay señales de alteración, duplicado u otra cuenta, pasa a revisión humana.";
    return [
      `Documento detectado: comprobante de pago (${ocr.descripcion}).`,
      `Resultado de verificación: ${status}.`,
      fields && `Datos leídos: ${fields}.`,
      issues.length > 0 && `Observaciones: ${issues.join(" | ")}.`,
      verdict,
    ]
      .filter(Boolean)
      .join("\n");
  }
  const fields = [
    ["Nombre", ocr.nombre_completo],
    ["CURP", ocr.curp],
    ["NSS", ocr.nss],
    ["RFC", ocr.rfc],
    ["Fecha de nacimiento", ocr.fecha_nacimiento],
    ["Domicilio", ocr.domicilio],
    ["Vigencia", ocr.vigencia],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
  return [
    `Documento detectado: ${ocr.tipo_documento} (${ocr.descripcion}). Lado: ${ocr.lado}.`,
    `Resultado de verificación: ${status}.`,
    fields && `Datos leídos: ${fields}.`,
    issues.length > 0 && `Observaciones: ${issues.join(" | ")}.`,
  ]
    .filter(Boolean)
    .join("\n");
}
