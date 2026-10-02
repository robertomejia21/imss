import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export const anthropic = new Anthropic(); // lee ANTHROPIC_API_KEY del entorno

export const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

/**
 * Si el modelo rechaza una solicitud por sus filtros de seguridad, la API la
 * re-ejecuta automáticamente en el modelo de respaldo recomendado.
 */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
