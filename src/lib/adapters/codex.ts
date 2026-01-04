import { execa } from "execa";
import type { AgentAdapter, ExecutionResult } from "./types.js";

/**
 * Adapter for OpenAI Codex CLI
 * https://github.com/openai/codex
 */
export const codexAdapter: AgentAdapter = {
  name: "codex",

  async execute({ cwd, prompt }): Promise<ExecutionResult> {
    const result = await execa("codex", ["exec", prompt, "--full-auto"], {
      cwd,
      timeout: 0,
      reject: false,
    });
    return { exitCode: result.exitCode ?? 0 };
  },

  async interactive({ cwd, prompt }): Promise<void> {
    const args = prompt ? [prompt] : [];
    await execa("codex", args, {
      cwd,
      stdio: "inherit",
    });
  },
};
