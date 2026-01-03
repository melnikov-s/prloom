import { join, resolve } from "path";
import { existsSync, readFileSync } from "fs";

export interface Config {
  worktrees_dir: string;
  poll_interval_ms: number;
}

const DEFAULTS: Config = {
  worktrees_dir: "../.swarm-worktrees",
  poll_interval_ms: 5000,
};

export function loadConfig(repoRoot: string): Config {
  const configPath = join(repoRoot, "swarm.config.json");

  if (!existsSync(configPath)) {
    return { ...DEFAULTS };
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      worktrees_dir: parsed.worktrees_dir ?? DEFAULTS.worktrees_dir,
      poll_interval_ms: parsed.poll_interval_ms ?? DEFAULTS.poll_interval_ms,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function resolveWorktreesDir(repoRoot: string, config: Config): string {
  return resolve(repoRoot, config.worktrees_dir);
}
