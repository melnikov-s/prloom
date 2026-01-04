import { execa } from "execa";

export async function resolveRepoRoot(cwd: string): Promise<string> {
  try {
    const { stdout } = await execa("git", ["rev-parse", "--show-toplevel"], {
      cwd,
    });
    return stdout.trim();
  } catch {
    throw new Error("Not inside a git repository");
  }
}
