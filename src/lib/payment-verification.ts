import "server-only";
import { verifySpeiTransfer, type CepData } from "@/lib/banxico-cep";
import { PAYMENT, formatMxn, isMinorIssue } from "@/lib/payments";
import { digits } from "@/lib/utils";
import type { DocumentStatus } from "@/lib/types";

/** Resultado de comparar el comprobante con el CEP de Banxico. */
export interface BanxicoCheck {
  /** confirmado: Banxico confirma la transferencia a nuestra CLABE por el monto esperado */
  estado: "confirmado" | "no_coincide" | "no_encontrado" | "no_verificado";
  detalle: string;
  cep?: CepData;
  consultado_en: string;
}

export const BANXICO_LABEL: Record<BanxicoCheck["estado"], string> = {
  confirmado: "Pago confirmado en Banxico (CEP)",
  no_coincide: "Banxico: la transferencia no coincide",
  no_encontrado: "Banxico no encuentra la transferencia",
  no_verificado: "Sin verificar en Banxico",
};

interface ReceiptData {
  monto: number | null;
  fecha_operacion: string | null;
  banco_emisor: string | null;
  clave_rastreo: string | null;
}

export async function checkReceiptWithBanxico(pago: ReceiptData | null, expectedAmount?: number): Promise<BanxicoCheck> {
  const now = new Date().toISOString();
  const missing = [
    !pago?.clave_rastreo && "clave de rastreo",
    !pago?.fecha_operacion && "fecha",
    !pago?.banco_emisor && "banco emisor",
    pago?.monto == null && "monto",
  ].filter(Boolean);
  if (!pago || missing.length) {
    return { estado: "no_verificado", detalle: `Faltan datos para consultar Banxico: ${missing.join(", ")}.`, consultado_en: now };
  }

  const r = await verifySpeiTransfer({
    fecha: pago.fecha_operacion!,
    claveRastreo: pago.clave_rastreo!,
    bancoEmisor: pago.banco_emisor!,
    cuentaBeneficiaria: PAYMENT.clabe,
    monto: pago.monto!,
  });
  if (r.result === "no_encontrado") return { estado: "no_encontrado", detalle: r.detail, consultado_en: now };
  if (r.result === "devuelto") return { estado: "no_coincide", detalle: r.detail, consultado_en: now };
  if (r.result !== "liquidado") return { estado: "no_verificado", detalle: r.detail, consultado_en: now };

  const problems: string[] = [];
  if (digits(r.cep.cuentaBeneficiaria) !== digits(PAYMENT.clabe)) problems.push(`la cuenta beneficiaria del CEP (${r.cep.cuentaBeneficiaria}) no es nuestra CLABE`);
  if (expectedAmount && Math.abs(r.cep.monto - expectedAmount) > 0.009)
    problems.push(`el monto del CEP (${formatMxn(r.cep.monto)}) no es el esperado (${formatMxn(expectedAmount)})`);
  return problems.length
    ? { estado: "no_coincide", detalle: `${r.detail} Pero ${problems.join(" y ")}.`, cep: r.cep, consultado_en: now }
    : { estado: "confirmado", detalle: r.detail, cep: r.cep, consultado_en: now };
}

/**
 * Combina el veredicto del OCR con Banxico. Banxico manda: si confirma el pago a nuestra CLABE
 * por el monto esperado, el comprobante es válido aunque la foto tenga detalles (salvo duplicado).
 */
export function applyBanxicoCheck(
  status: DocumentStatus,
  issues: string[],
  bx: BanxicoCheck,
  isDuplicate: boolean,
): { status: DocumentStatus; issues: string[] } {
  switch (bx.estado) {
    case "confirmado":
      return isDuplicate ? { status, issues } : { status: "valido", issues: issues.filter(isMinorIssue) };
    case "no_coincide":
    case "no_encontrado":
      return { status: status === "invalido" ? status : "con_observaciones", issues: [`${BANXICO_LABEL[bx.estado]}: ${bx.detalle}`, ...issues] };
    case "no_verificado":
      return { status, issues: [...issues, `Observación menor: no se pudo verificar en Banxico (${bx.detalle})`] };
  }
}

/** Línea para el agente de WhatsApp sobre la verificación bancaria. */
export function banxicoLineForAgent(bx: BanxicoCheck) {
  switch (bx.estado) {
    case "confirmado":
      return "VERIFICACIÓN BANXICO: la transferencia está CONFIRMADA en el sistema SPEI de Banxico (CEP). Puedes decirle que su pago ya quedó confirmado.";
    case "no_coincide":
      return "VERIFICACIÓN BANXICO: la transferencia existe pero NO coincide con nuestra cuenta o el monto. No la des por válida; pasa el caso a un asesor.";
    case "no_encontrado":
      return "VERIFICACIÓN BANXICO: todavía no aparece en Banxico. No digas que es falso: dile que estamos confirmando su transferencia con el banco (a veces tarda unos minutos) y que le avisamos. Pide que revise que la clave de rastreo se vea completa.";
    case "no_verificado":
      return `VERIFICACIÓN BANXICO: no se pudo verificar automáticamente (${bx.detalle}). Un asesor lo concilia contra el banco.`;
  }
}
