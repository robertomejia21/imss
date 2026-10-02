export type LeadStatus =
  | "nuevo"
  | "en_conversacion"
  | "registro_completo"
  | "documentos_pendientes"
  | "en_revision"
  | "en_tramite"
  | "completado"
  | "descartado";

export type MessageType = "text" | "image" | "audio" | "document" | "video" | "location" | "other";
export type MessageSender = "lead" | "ai" | "agent" | "system";
export type DocumentStatus = "pendiente" | "procesando" | "valido" | "con_observaciones" | "invalido" | "error";
export type TramiteStatus = "pendiente" | "en_proceso" | "en_espera_imss" | "resuelto" | "rechazado" | "cancelado";

export interface Lead {
  id: string;
  folio: string;
  phone: string | null;
  wa_chat_id: string | null;
  wa_name: string | null;
  full_name: string | null;
  curp: string | null;
  nss: string | null;
  rfc: string | null;
  email: string | null;
  birth_date: string | null;
  tramite_type: string | null;
  status: LeadStatus;
  source: string;
  utm: Record<string, string>;
  form_data: Record<string, unknown>;
  captured_data: Record<string, unknown>;
  ai_enabled: boolean;
  needs_human: boolean;
  needs_human_reason: string | null;
  assigned_to: string | null;
  notes: string | null;
  last_message_at: string | null;
  last_inbound_at: string | null;
  unread_count: number;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  lead_id: string;
  direction: "in" | "out";
  sender: MessageSender;
  type: MessageType;
  body: string | null;
  transcription: string | null;
  media_path: string | null;
  media_mime: string | null;
  wa_message_id: string | null;
  status: string | null;
  sent_by: string | null;
  meta: Record<string, unknown>;
  created_at: string;
}

export interface DocumentRow {
  id: string;
  lead_id: string;
  message_id: string | null;
  doc_type: string | null;
  storage_path: string;
  mime: string | null;
  status: DocumentStatus;
  extracted: Record<string, unknown>;
  issues: string[];
  confidence: number | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
}

export interface Tramite {
  id: string;
  lead_id: string;
  tipo: string;
  status: TramiteStatus;
  folio_imss: string | null;
  due_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: string;
  lead_id: string;
  kind: string;
  content: string;
  meta: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
}

export interface AgentSettings {
  id: number;
  enabled: boolean;
  agent_name: string;
  system_prompt: string;
  effort: "low" | "medium" | "high";
  reply_delay_seconds: number;
  history_limit: number;
  updated_at: string;
}

export interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  role: "admin" | "asesor";
}
