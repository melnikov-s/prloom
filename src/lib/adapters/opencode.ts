import { execa } from "execa";
import type { AgentAdapter, ExecutionResult } from "./types.js";

/**
 * Adapter for OpenCode CLI
 * https://opencode.ai
 */
export const opencodeAdapter: AgentAdapter = {
  name: "opencode",

  async execute({ cwd, prompt }): Promise<ExecutionResult> {
    const result = await execa("opencode", ["run", prompt], {
      cwd,
      timeout: 0,
      reject: false,
    });
    return { exitCode: result.exitCode ?? 0 };
  },

  async interactive({ cwd, prompt }): Promise<void> {
    const args = prompt ? ["--prompt", prompt] : [];
    await execa("opencode", args, {
      cwd,
      stdio: "inherit",
    });
  },
};
