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
  "foto_persona",
  "constancia_semanas",
  "rfc",
  "comprobante_pago",
  "talon_pago",
  "formato_autorizacion",
  "selfie_ine",
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

const FotoSchema = z.object({
  rostro_visible: z.boolean().describe("¿Se ve el rostro completo, de frente, sin lentes oscuros, gorra ni cubrebocas?"),
  una_sola_persona: z.boolean().describe("¿Aparece una sola persona?"),
  fondo_claro_despejado: z.boolean().describe("¿El fondo es claro y despejado (pared lisa, sin objetos ni otras personas)?"),
  buena_iluminacion: z.boolean().describe("¿La foto tiene buena luz y está enfocada?"),
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
  foto: FotoSchema.nullable().describe("Solo para foto_persona (foto de una persona, no de un documento); null en cualquier otro caso"),
  otros_datos: z.array(z.object({ campo: z.string(), valor: z.string() })),
  observaciones: z.array(z.string()).describe("Problemas detectados, en español, dirigidos al asesor"),
  confianza: z.number().describe("0 a 1: confianza general de la extracción"),
});

export type OcrResult = z.infer<typeof OcrSchema>;

/**
 * Esquema que se envía a la API. La salida estructurada tiene un límite de tamaño de gramática:
 * cada campo "nullable" la agranda, así que los textos simples viajan como string ("" = no aparece)
 * y se convierten de vuelta a null al recibirlos. El resto del sistema usa OcrResult sin cambios.
 */
const TEXT_FIELDS = [
  "nombre_completo",
  "curp",
  "nss",
  "rfc",
  "clave_elector",
  "fecha_nacimiento",
  "sexo",
  "domicilio",
  "codigo_postal",
  "fecha_emision",
  "vigencia",
] as const;

const PAGO_TEXT_FIELDS = [
  "fecha_operacion",
  "banco_emisor",
  "banco_destino",
  "beneficiario",
  "cuenta_destino",
  "clave_rastreo",
  "folio_operacion",
  "concepto",
  "referencia",
  "ordenante",
] as const;

const asText = (schema: z.ZodTypeAny) => z.string().describe(`${schema.description ?? ""} ("" si no aparece o no se puede leer)`.trim());

const WirePagoSchema = PagoSchema.extend(Object.fromEntries(PAGO_TEXT_FIELDS.map((k) => [k, asText(PagoSchema.shape[k])])) as {
  [K in (typeof PAGO_TEXT_FIELDS)[number]]: z.ZodString;
});

const WireOcrSchema = OcrSchema.extend({
  ...(Object.fromEntries(TEXT_FIELDS.map((k) => [k, asText(OcrSchema.shape[k])])) as { [K in (typeof TEXT_FIELDS)[number]]: z.ZodString }),
  pago: WirePagoSchema.nullable().describe("Solo para comprobantes de pago o transferencia; null en cualquier otro documento"),
});

const emptyToNull = <T extends Record<string, unknown>>(obj: T, keys: readonly string[]) =>
  Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, keys.includes(k) && typeof v === "string" && !v.trim() ? null : v])) as T;

function fromWire(w: z.infer<typeof WireOcrSchema>): OcrResult {
  return {
    ...emptyToNull(w, TEXT_FIELDS),
    pago: w.pago ? emptyToNull(w.pago, PAGO_TEXT_FIELDS) : null,
  } as OcrResult;
}

const OCR_PROMPT = `Eres un verificador de documentos para trámites del IMSS en México.
Analiza el documento adjunto y extrae sus datos con precisión, carácter por carácter.
- Transcribe CURP, NSS, RFC y clave de elector exactamente como aparecen (mayúsculas, sin espacios).
- Si un dato no aparece o no se puede leer, usa null. Nunca inventes datos.
- Para INE/credencial, indica si la foto muestra el frente, el reverso o ambos, y la vigencia.
- Si es un comprobante de pago, transferencia (SPEI), depósito o ticket bancario: tipo_documento = "comprobante_pago", llena "pago" con monto, fecha, cuentas, clave de rastreo, concepto y ordenante, y deja nombre_completo, curp y nss en null. Revisa con cuidado señales de edición (tipografías distintas, cifras desalineadas, recortes).
- Si es la foto de una persona (selfie o retrato, no un documento ni una INE): tipo_documento = "foto_persona", llena "foto" y deja los datos personales en null. es_documento_oficial = true si es una foto real de la persona (no captura de pantalla, foto de otra foto ni imagen de internet).
- Si es un talón o recibo de pago de nómina, de pensión o de jubilación (por ejemplo el "Comprobante de percepciones y descuentos de nómina" de IMSS-Bienestar, que es un CFDI): tipo_documento = "talon_pago"; en nombre_completo el trabajador o pensionado, curp/nss/rfc tal como aparecen, y en otros_datos agrega, con estos nombres de campo exactos: "emisor" (quién paga, ej. IMSS-BIENESTAR), "numero_empleado", "regimen_contratacion" (ej. BASE, CONFIANZA), "puesto", "periodo", "fecha_pago" (YYYY-MM-DD) e "importe_neto" (solo número, ej. 9115.35). Agrega también la delegación o entidad si aparece.
- Si es un formato o carta de autorización llenado por el cliente (por ejemplo la "Autorización de consulta y reserva en plataforma Nomi-Pay"): tipo_documento = "formato_autorizacion"; en nombre_completo el nombre del trabajador escrito y en otros_datos agrega, con estos nombres de campo exactos: "firma_trabajador" ("si" o "no": ¿hay firma manuscrita en el renglón del trabajador?), "numero_empleado_rfc" y "fecha". Los renglones del promotor y el folio pueden venir vacíos: es normal.
- Si es una selfie de la persona sosteniendo su INE: tipo_documento = "selfie_ine"; es_documento_oficial = true si es una foto real donde se ven el rostro y la INE original; en observaciones anota si la INE no se lee o el rostro no coincide con la foto de la INE.
- Si es un estado de cuenta bancario: tipo_documento = "estado_cuenta"; en nombre_completo pon el titular y en otros_datos el banco y la CLABE o número de cuenta tal como aparecen.
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
    output_config: { effort: "medium", format: betaZodOutputFormat(WireOcrSchema) },
    messages: [{ role: "user", content: [source, { type: "text", text: OCR_PROMPT }] }],
  });

  if (response.stop_reason === "refusal") throw new Error("El modelo no pudo procesar este documento");
  if (!response.parsed_output) throw new Error("No se pudo interpretar el resultado del OCR");
  return fromWire(response.parsed_output);
}

/** Valor de otros_datos por nombre de campo (sin importar mayúsculas). */
export const ocrDato = (ocr: OcrResult, campo: string) =>
  ocr.otros_datos.find((d) => d.campo.trim().toLowerCase() === campo)?.valor?.trim() || null;

/** Reglas de negocio sobre el resultado del OCR → estado del documento + observaciones. */
export function evaluateDocument(
  ocr: OcrResult,
  lead: { folio: string; full_name: string | null; curp: string | null; nss: string | null; captured_data: Record<string, unknown> },
): { status: DocumentStatus; issues: string[] } {
  if (ocr.tipo_documento === "comprobante_pago") return evaluateReceipt(ocr, lead);
  if (ocr.tipo_documento === "foto_persona") return evaluatePhoto(ocr);
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

  if (ocr.tipo_documento === "talon_pago") {
    const fechaPago = ocrDato(ocr, "fecha_pago");
    const emisor = ocrDato(ocr, "emisor");
    if (!fechaPago) issues.push("No se pudo leer la fecha de pago del talón");
    else if (/^\d{4}-\d{2}-\d{2}/.test(fechaPago) && Date.now() - new Date(fechaPago).getTime() > 62 * 86_400_000)
      issues.push(`El talón no es reciente (fecha de pago ${fechaPago}); se necesita el último`);
    if (lead.captured_data?.prestamo_perfil === "activo_imss_bienestar" && emisor && !/BIENESTAR/i.test(emisor))
      issues.push(`El talón lo emite ${emisor}, no IMSS-Bienestar`);
  }
  if (ocr.tipo_documento === "formato_autorizacion") {
    if (!/^s[ií]/i.test(ocrDato(ocr, "firma_trabajador") ?? "")) issues.push("El formato de autorización no tiene la firma del trabajador");
    if (!ocr.nombre_completo) issues.push("El formato de autorización no tiene el nombre del trabajador");
  }

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

/** Foto de la persona (retiro por desempleo): rostro visible, una persona, fondo claro y despejado. */
function evaluatePhoto(ocr: OcrResult): { status: DocumentStatus; issues: string[] } {
  const f = ocr.foto;
  const issues = [...ocr.observaciones];
  if (!f) issues.push("No se pudo evaluar la foto");
  else {
    if (!f.rostro_visible) issues.push("El rostro no se ve completo o de frente");
    if (!f.una_sola_persona) issues.push("Aparece más de una persona");
    if (!f.fondo_claro_despejado) issues.push("El fondo no es claro y despejado");
    if (!f.buena_iluminacion) issues.push("La foto está oscura o desenfocada");
  }
  if (ocr.posible_alteracion || !ocr.es_documento_oficial) issues.push("No parece una foto real de la persona");
  const status: DocumentStatus = !f || !f.rostro_visible || !ocr.es_documento_oficial
    ? "invalido"
    : issues.length > 0
      ? "con_observaciones"
      : "valido";
  return { status, issues: [...new Set(issues)] };
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
    ["Clave de elector", ocr.clave_elector],
    ["Fecha de nacimiento", ocr.fecha_nacimiento],
    ["Domicilio", ocr.domicilio],
    ["Vigencia", ocr.vigencia],
    ...ocr.otros_datos.map((d) => [d.campo, d.valor]),
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
