import type { DocumentStatus, LeadStatus, TramiteStatus } from "./types";

export const LEAD_STATUSES: { value: LeadStatus; label: string; tone: string }[] = [
  { value: "nuevo", label: "Nuevo", tone: "bg-sky-50 text-sky-700 ring-sky-600/20" },
  { value: "en_conversacion", label: "En conversación", tone: "bg-indigo-50 text-indigo-700 ring-indigo-600/20" },
  { value: "registro_completo", label: "Registro completo", tone: "bg-brand-50 text-brand-700 ring-brand-600/20" },
  { value: "documentos_pendientes", label: "Docs. pendientes", tone: "bg-amber-50 text-amber-800 ring-amber-600/20" },
  { value: "en_revision", label: "En revisión", tone: "bg-violet-50 text-violet-700 ring-violet-600/20" },
  { value: "en_tramite", label: "En trámite", tone: "bg-teal-50 text-teal-700 ring-teal-600/20" },
  { value: "completado", label: "Completado", tone: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  { value: "descartado", label: "Descartado", tone: "bg-stone-100 text-stone-600 ring-stone-500/20" },
];

export const leadStatusMeta = (s: LeadStatus) => LEAD_STATUSES.find((x) => x.value === s) ?? LEAD_STATUSES[0];

export const DOCUMENT_STATUSES: Record<DocumentStatus, { label: string; tone: string }> = {
  pendiente: { label: "Pendiente", tone: "bg-stone-100 text-stone-600 ring-stone-500/20" },
  procesando: { label: "Procesando OCR", tone: "bg-sky-50 text-sky-700 ring-sky-600/20" },
  valido: { label: "Válido", tone: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  con_observaciones: { label: "Con observaciones", tone: "bg-amber-50 text-amber-800 ring-amber-600/20" },
  invalido: { label: "Inválido", tone: "bg-red-50 text-red-700 ring-red-600/20" },
  error: { label: "Error", tone: "bg-red-50 text-red-700 ring-red-600/20" },
};

export const TRAMITE_STATUSES: Record<TramiteStatus, { label: string; tone: string }> = {
  pendiente: { label: "Pendiente", tone: "bg-stone-100 text-stone-600 ring-stone-500/20" },
  en_proceso: { label: "En proceso", tone: "bg-sky-50 text-sky-700 ring-sky-600/20" },
  en_espera_imss: { label: "En espera IMSS", tone: "bg-amber-50 text-amber-800 ring-amber-600/20" },
  resuelto: { label: "Resuelto", tone: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  rechazado: { label: "Rechazado", tone: "bg-red-50 text-red-700 ring-red-600/20" },
  cancelado: { label: "Cancelado", tone: "bg-stone-100 text-stone-500 ring-stone-500/20" },
};

export const DOC_TYPES: Record<string, string> = {
  ine: "INE / Identificación",
  curp: "CURP",
  nss: "Número de Seguridad Social",
  comprobante_domicilio: "Comprobante de domicilio",
  acta_nacimiento: "Acta de nacimiento",
  estado_cuenta: "Estado de cuenta",
  constancia_semanas: "Constancia de semanas cotizadas",
  rfc: "Constancia de situación fiscal",
  otro: "Otro",
};

export const TRAMITE_TYPES = [
  "Pensión por cesantía / vejez",
  "Modalidad 40",
  "Modalidad 10",
  "Constancia de semanas cotizadas",
  "Asignación / localización de NSS",
  "Alta en clínica (UMF)",
  "Retiro por desempleo",
  "Corrección de datos",
  "Otro",
];
