import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Lee ANTHROPIC_API_KEY del entorno. Las keys de usuario (sk-ant-usr-…) no están ligadas a un
 * workspace: en ese caso hay que indicar cuál usar con ANTHROPIC_WORKSPACE_ID (wrkspc_…).
 */
const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();

export const anthropic = new Anthropic(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {});

export const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

/**
 * Si el modelo rechaza una solicitud por sus filtros de seguridad, la API la
 * re-ejecuta automáticamente en el modelo de respaldo recomendado.
 */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
