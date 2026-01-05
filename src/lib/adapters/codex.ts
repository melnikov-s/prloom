import { execa } from "execa";
import type { AgentAdapter, ExecutionResult, TmuxConfig } from "./types.js";
import { waitForTmuxSession } from "./tmux.js";

/**
 * Adapter for OpenAI Codex CLI
 * https://github.com/openai/codex
 */
export const codexAdapter: AgentAdapter = {
  name: "codex",

  async execute({ cwd, prompt, tmux }): Promise<ExecutionResult> {
    const args = ["exec", prompt, "--full-auto"];

    if (tmux) {
      // Spawn in detached tmux session
      await execa(
        "tmux",
        [
          "new-session",
          "-d",
          "-s",
          tmux.sessionName,
          "-c",
          cwd,
          "codex",
          ...args,
        ],
        { reject: false }
      );
      // Wait for session to complete
      await waitForTmuxSession(tmux.sessionName);
      return { exitCode: 0 };
    }

    // Direct execution (no tmux)
    const result = await execa("codex", args, {
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
