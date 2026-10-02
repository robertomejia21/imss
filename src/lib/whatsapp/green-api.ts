import "server-only";

/**
 * Cliente mínimo de Green API (https://green-api.com/docs/api/).
 * Todas las llamadas usan: {apiUrl}/waInstance{idInstance}/{método}/{apiTokenInstance}
 */

const apiUrl = () => process.env.GREEN_API_URL ?? "https://api.green-api.com";
const mediaUrl = () => process.env.GREEN_API_MEDIA_URL ?? "https://media.green-api.com";
const idInstance = () => process.env.GREEN_API_ID_INSTANCE!;
const token = () => process.env.GREEN_API_TOKEN_INSTANCE!;

export const isGreenApiConfigured = () => Boolean(process.env.GREEN_API_ID_INSTANCE && process.env.GREEN_API_TOKEN_INSTANCE);

async function call<T>(method: string, body?: unknown, base = apiUrl()): Promise<T> {
  const url = `${base}/waInstance${idInstance()}/${method}/${token()}`;
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Green API ${method} → ${res.status}: ${await res.text().catch(() => "")}`);
  }
  return (await res.json()) as T;
}

/** Envía un mensaje de texto. Devuelve el idMessage. WhatsApp limita a ~20,000 caracteres. */
export async function sendText(chatId: string, message: string) {
  const r = await call<{ idMessage: string }>("sendMessage", { chatId, message });
  return r.idMessage;
}

/** Envía un archivo por URL pública (por ejemplo, una URL firmada de Supabase Storage). */
export async function sendFileByUrl(chatId: string, urlFile: string, fileName: string, caption?: string) {
  const r = await call<{ idMessage: string }>("sendFileByUrl", { chatId, urlFile, fileName, caption });
  return r.idMessage;
}

export async function getStateInstance() {
  return call<{ stateInstance: string }>("getStateInstance");
}

export async function getSettings() {
  return call<Record<string, unknown>>("getSettings");
}

/** Configura el webhook de la instancia para que apunte a este CRM. */
export async function setWebhook(webhookUrl: string, webhookUrlToken?: string) {
  return call<{ saveSettings: boolean }>("setSettings", {
    webhookUrl,
    webhookUrlToken: webhookUrlToken ?? "",
    incomingWebhook: "yes",
    outgoingMessageWebhook: "yes",
    outgoingAPIMessageWebhook: "yes",
    stateWebhook: "yes",
    markIncomingMessagesReaded: "no",
  });
}

export async function readChat(chatId: string) {
  return call<{ setRead: boolean }>("readChat", { chatId }).catch(() => null);
}

/** Obtiene la URL de descarga de un archivo cuando el webhook no la trae. */
export async function getDownloadUrl(chatId: string, idMessage: string) {
  const r = await call<{ downloadUrl: string }>("downloadFile", { chatId, idMessage });
  return r.downloadUrl;
}

export async function downloadMedia(downloadUrl: string) {
  const res = await fetch(downloadUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo descargar el archivo (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType: res.headers.get("content-type") ?? "application/octet-stream" };
}

export { mediaUrl };

// ---------- Tipos de webhooks ----------
export interface GreenFileData {
  downloadUrl?: string;
  caption?: string;
  fileName?: string;
  mimeType?: string;
  jpegThumbnail?: string;
}

export interface GreenWebhook {
  typeWebhook:
    | "incomingMessageReceived"
    | "outgoingMessageReceived"
    | "outgoingAPIMessageReceived"
    | "outgoingMessageStatus"
    | "stateInstanceChanged"
    | string;
  instanceData?: { idInstance: number; wid: string; typeInstance: string };
  timestamp?: number;
  idMessage?: string;
  status?: string; // outgoingMessageStatus: sent | delivered | read | failed | noAccount…
  chatId?: string; // outgoingMessageStatus
  senderData?: {
    chatId: string;
    sender: string;
    chatName?: string;
    senderName?: string;
    senderContactName?: string;
  };
  messageData?: {
    typeMessage: string;
    textMessageData?: { textMessage: string };
    extendedTextMessageData?: { text: string; description?: string; title?: string };
    fileMessageData?: GreenFileData;
    locationMessageData?: { latitude: number; longitude: number; nameLocation?: string; address?: string };
    quotedMessage?: unknown;
    reactionMessageData?: unknown;
    contactMessageData?: { displayName?: string; vcard?: string };
    buttonsResponseMessage?: { selectedButtonText?: string };
    listResponseMessage?: { title?: string };
  };
}
