import { execa } from "execa";
import type { AgentAdapter, ExecutionResult, TmuxConfig } from "./types.js";
import { waitForTmuxSession } from "./tmux.js";

/**
 * Adapter for OpenCode CLI
 * https://opencode.ai
 */
export const opencodeAdapter: AgentAdapter = {
  name: "opencode",

  async execute({ cwd, prompt, tmux }): Promise<ExecutionResult> {
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
          "opencode",
          "run",
          prompt,
        ],
        { reject: false }
      );
      // Wait for session to complete
      await waitForTmuxSession(tmux.sessionName);
      return { exitCode: 0 };
    }

    // Direct execution (no tmux)
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
