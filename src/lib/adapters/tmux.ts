import { execa } from "execa";

/**
 * Wait for a tmux session to complete (session no longer exists).
 * Polls every second until the session ends.
 */
export async function waitForTmuxSession(sessionName: string): Promise<void> {
  while (true) {
    const { exitCode } = await execa(
      "tmux",
      ["has-session", "-t", sessionName],
      {
        reject: false,
      }
    );
    if (exitCode !== 0) {
      // Session no longer exists - worker finished
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
