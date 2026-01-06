import { join, resolve } from "path";
import { existsSync, readFileSync } from "fs";
import { type AgentName, isAgentName } from "./adapters/index.js";

export interface AgentsConfig {
  default: AgentName;
  designer?: AgentName;
}

export interface Config {
  agents: AgentsConfig;
  worktrees_dir: string;
  github_poll_interval_ms: number;
  base_branch: string;
}

const DEFAULTS: Config = {
  agents: {
    default: "opencode",
  },
  worktrees_dir: "prloom/.local/worktrees",
  github_poll_interval_ms: 60000, // 60 seconds for GitHub API rate limits
  base_branch: "main",
};

export function loadConfig(repoRoot: string): Config {
  const configPath = join(repoRoot, "prloom", "config.json");

  if (!existsSync(configPath)) {
    return { ...DEFAULTS };
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);

    // Parse agents config
    const agents: AgentsConfig = {
      default:
        parseAgentName(parsed.agents?.default) ?? DEFAULTS.agents.default,
      designer: parseAgentName(parsed.agents?.designer),
    };

    return {
      agents,
      worktrees_dir: parsed.worktrees_dir ?? DEFAULTS.worktrees_dir,
      github_poll_interval_ms:
        parsed.github_poll_interval_ms ?? DEFAULTS.github_poll_interval_ms,
      base_branch:
        typeof parsed.base_branch === "string" && parsed.base_branch.trim()
          ? parsed.base_branch
          : DEFAULTS.base_branch,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function parseAgentName(value: unknown): AgentName | undefined {
  if (typeof value === "string" && isAgentName(value)) {
    return value;
  }
  return undefined;
}

export function resolveWorktreesDir(repoRoot: string, config: Config): string {
  return resolve(repoRoot, config.worktrees_dir);
}
