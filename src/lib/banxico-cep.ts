import "server-only";

/**
 * Verificación de transferencias SPEI con el CEP (Comprobante Electrónico de Pago) de Banxico:
 * https://www.banxico.org.mx/cep/
 *
 * Solo aplica a transferencias SPEI entre bancos distintos. No sirve para depósitos en ventanilla,
 * OXXO ni transferencias entre cuentas del mismo banco (no pasan por SPEI).
 * Banxico puede pedir captcha si detecta muchas consultas; en ese caso se devuelve "error".
 */

const BASE = "https://www.banxico.org.mx/cep";
const TIMEOUT_MS = 20_000;

export type CepResult =
  | { result: "liquidado"; detail: string; cep: CepData }
  | { result: "devuelto" | "no_encontrado" | "no_verificable" | "error"; detail: string; cep?: undefined };

export interface CepData {
  fecha: string;
  hora: string;
  monto: number;
  bancoEmisor: string;
  ordenante: string;
  cuentaOrdenante: string;
  bancoReceptor: string;
  beneficiario: string;
  cuentaBeneficiaria: string;
  concepto: string;
}

export interface CepQuery {
  /** YYYY-MM-DD */
  fecha: string;
  claveRastreo: string;
  /** Nombre del banco emisor tal como aparece en el comprobante */
  bancoEmisor: string;
  /** CLABE de 18 dígitos que recibió el pago */
  cuentaBeneficiaria: string;
  monto: number;
}

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\b(BANCO|BANCA|S\.?A\.?|DE|C\.?V\.?|INSTITUCION|MULTIPLE|GRUPO|FINANCIERO|MEXICO)\b/g, " ")
    .replace(/[^A-Z0-9]/g, "");

/** Nombres comerciales → nombre en el catálogo de Banxico (ya normalizados). */
const BANK_ALIASES: Record<string, string> = {
  NU: "NUBANK",
  BANCOMER: "BBVA",
  BBVABANCOMER: "BBVA",
  CITIBANAMEX: "BANAMEX",
  CITI: "BANAMEX",
  OXXO: "SPINBYOXXO",
  MERCADOLIBRE: "MERCADOPAGOW",
};

/** Sesión mínima: Banxico exige la cookie de la página principal en cada paso. */
function session() {
  const jar = new Map<string, string>();
  return async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${BASE}/${path}`, {
      ...init,
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        ...init.headers,
      },
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair!.indexOf("=");
      if (i > 0) jar.set(pair!.slice(0, i).trim(), pair!.slice(i + 1).trim());
    }
    return res;
  };
}

const ddmmyyyy = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}-${m}-${y}`;
};

const attr = (xml: string, tag: string, name: string) =>
  xml.match(new RegExp(`<${tag}\\b[^>]*\\s${name}="([^"]*)"`))?.[1] ?? "";

export async function verifySpeiTransfer(q: CepQuery): Promise<CepResult> {
  const clabe = q.cuentaBeneficiaria.replace(/\D/g, "");
  const clave = q.claveRastreo.trim().replace(/\s/g, "");
  if (clabe.length !== 18) return { result: "no_verificable", detail: "La CLABE de cobro no está configurada (18 dígitos)." };
  if (!clave) return { result: "no_verificable", detail: "El comprobante no muestra clave de rastreo SPEI." };
  if (!/^\d{4}-\d{2}-\d{2}/.test(q.fecha)) return { result: "no_verificable", detail: "No se pudo leer la fecha de la operación." };

  try {
    let go = session();
    await go("");

    // Catálogo de bancos vigente en la fecha del pago
    const inst = (await (await go(`instituciones.do?fecha=${ddmmyyyy(q.fecha)}`)).json()) as { instituciones: [string, string][] };
    const banks = inst.instituciones ?? [];
    const receptor = banks.find(([code]) => code.slice(-3) === clabe.slice(0, 3) && code.length === 5);
    if (!receptor) return { result: "no_verificable", detail: `No se identificó el banco de la CLABE de cobro (${clabe.slice(0, 3)}).` };

    const wanted = BANK_ALIASES[normalize(q.bancoEmisor)] ?? normalize(q.bancoEmisor);
    // Coincidencia exacta o, si no, la más específica (nombre más largo) que contenga o esté contenida
    const emisor =
      banks.find(([, name]) => normalize(name) === wanted) ??
      banks
        .filter(([, name]) => {
          const n = normalize(name);
          return n.length >= 3 && wanted.length >= 3 && (n.includes(wanted) || wanted.includes(n));
        })
        .sort((a, b) => normalize(b[1]).length - normalize(a[1]).length)[0];
    if (!emisor) return { result: "no_verificable", detail: `No se identificó el banco emisor "${q.bancoEmisor}" en el catálogo de Banxico.` };
    if (emisor[0] === receptor[0]) {
      return { result: "no_verificable", detail: `Transferencia dentro del mismo banco (${receptor[1]}): no pasa por SPEI y no genera CEP.` };
    }

    const form = new URLSearchParams({
      tipoCriterio: "T",
      fecha: ddmmyyyy(q.fecha),
      criterio: clave,
      emisor: emisor[0],
      receptor: receptor[0],
      cuenta: clabe,
      receptorParticipante: "0",
      monto: q.monto.toFixed(2),
      captcha: "c",
      tipoConsulta: "1",
    });
    const consulta = async () => {
      const html = await (
        await go("valida.do", { method: "POST", body: form, headers: { "Content-Type": "application/x-www-form-urlencoded" } })
      ).text();
      return { html, text: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") };
    };
    // Banxico pide la imagen de seguridad (captcha) cuando recibe muchas consultas: un reintento con otra sesión
    const isCaptcha = (t: string) => /imagen de seguridad|c.{1,2}digo de seguridad/i.test(t) && !/operacionesLiquidados|SPEI no ha recibido/i.test(t);
    let { html, text } = await consulta();
    if (isCaptcha(text)) {
      await new Promise((r) => setTimeout(r, 4000));
      go = session();
      await go("");
      ({ html, text } = await consulta());
    }

    // La página viene en ISO-8859-1: los acentos pueden llegar dañados, por eso ".{1,2}"
    if (/P.{1,2}gina no encontrada/i.test(text)) {
      return { result: "error", detail: "Banxico rechazó la consulta (sesión no válida); verificar manualmente en banxico.org.mx/cep." };
    }
    if (/operacionesDevueltas/.test(html) && !/operacionesLiquidados/.test(html)) {
      return { result: "devuelto", detail: `Banxico indica que la transferencia con clave ${clave} fue DEVUELTA al ordenante.` };
    }
    if (/Operaci.{1,2}n no encontrada|SPEI no ha recibido/i.test(text)) {
      return {
        result: "no_encontrado",
        detail: `Banxico no encontró una transferencia SPEI con clave ${clave} del ${q.fecha} de ${emisor[1]} a ${receptor[1]} por ${q.monto.toFixed(2)}.`,
      };
    }
    if (isCaptcha(text)) {
      return { result: "error", detail: "Banxico pidió imagen de seguridad (captcha); reintentar más tarde con el botón o verificar en banxico.org.mx/cep." };
    }

    const xml = await (await go("descarga.do?formato=XML")).text();
    if (!xml.includes("<SPEI_Tercero")) {
      return { result: "error", detail: "Banxico respondió, pero no entregó el CEP; verificar manualmente en banxico.org.mx/cep." };
    }
    const cep: CepData = {
      fecha: attr(xml, "SPEI_Tercero", "FechaOperacion"),
      hora: attr(xml, "SPEI_Tercero", "Hora"),
      monto: Number(attr(xml, "Beneficiario", "MontoPago")),
      bancoEmisor: attr(xml, "Ordenante", "BancoEmisor"),
      ordenante: attr(xml, "Ordenante", "Nombre"),
      cuentaOrdenante: attr(xml, "Ordenante", "Cuenta"),
      bancoReceptor: attr(xml, "Beneficiario", "BancoReceptor"),
      beneficiario: attr(xml, "Beneficiario", "Nombre"),
      cuentaBeneficiaria: attr(xml, "Beneficiario", "Cuenta"),
      concepto: attr(xml, "Beneficiario", "Concepto"),
    };
    return {
      result: "liquidado",
      detail: `CEP de Banxico: ${cep.fecha} ${cep.hora}, ${cep.monto.toFixed(2)} MXN de ${cep.ordenante} (${cep.bancoEmisor}) a ${cep.beneficiario} (${cep.bancoReceptor}).`,
      cep,
    };
  } catch (e) {
    return { result: "error", detail: `No se pudo consultar Banxico: ${(e as Error).message}` };
  }
}
