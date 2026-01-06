import type { AgentAdapter, AgentName } from "./types.js";
import { codexAdapter } from "./codex.js";
import { opencodeAdapter } from "./opencode.js";
import { claudeAdapter } from "./claude.js";
import { geminiAdapter } from "./gemini.js";
import { manualAdapter } from "./manual.js";

export type { AgentAdapter, AgentName, ExecutionResult } from "./types.js";
export { isAgentName } from "./types.js";

const adapters: Record<AgentName, AgentAdapter> = {
  codex: codexAdapter,
  opencode: opencodeAdapter,
  claude: claudeAdapter,
  gemini: geminiAdapter,
  manual: manualAdapter,
};

/**
 * Get an adapter by name.
 * @throws Error if agent name is unknown
 */
export function getAdapter(name: AgentName): AgentAdapter {
  const adapter = adapters[name];
  if (!adapter) {
    throw new Error(`Unknown agent: ${name}`);
  }
  return adapter;
}

/**
 * Get all registered agent names.
 */
export function getAgentNames(): AgentName[] {
  return Object.keys(adapters) as AgentName[];
}
