import "server-only";

const OPENAI_TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL ?? "gpt-4o-mini-transcribe";

export const isTranscriptionConfigured = () => Boolean(process.env.OPENAI_API_KEY);

/**
 * Transcribe una nota de voz con OpenAI. Claude no recibe audio directamente,
 * por eso el audio se convierte a texto y el agente responde siempre por texto.
 */
export async function transcribeAudio(audio: Buffer, mime: string, fileName = "audio.ogg"): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Falta OPENAI_API_KEY para transcribir audios");

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime || "audio/ogg" }), fileName);
  form.append("model", OPENAI_TRANSCRIPTION_MODEL);
  form.append("language", "es");
  form.append("response_format", "json");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Transcripción falló (${res.status}): ${await res.text().catch(() => "")}`);
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}
