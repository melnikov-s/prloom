import { join, resolve } from "path";
import { existsSync, readFileSync } from "fs";
import { type AgentName, isAgentName } from "./adapters/index.js";

export interface AgentStageConfig {
  agent: AgentName;
  model?: string;
}

export type AgentStage = "designer" | "worker" | "reviewer" | "triage";

export interface AgentsConfig {
  default: AgentStageConfig;
  designer?: AgentStageConfig;
  worker?: AgentStageConfig;
  reviewer?: AgentStageConfig;
  triage?: AgentStageConfig;
}

export interface Config {
  agents: AgentsConfig;
  worktrees_dir: string;
  github_poll_interval_ms: number;
  base_branch: string;
}

const DEFAULTS: Config = {
  agents: {
    default: { agent: "opencode" },
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
        parseAgentStageConfig(parsed.agents?.default) ?? DEFAULTS.agents.default,
      designer: parseAgentStageConfig(parsed.agents?.designer),
      worker: parseAgentStageConfig(parsed.agents?.worker),
      reviewer: parseAgentStageConfig(parsed.agents?.reviewer),
      triage: parseAgentStageConfig(parsed.agents?.triage),
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

function parseAgentStageConfig(value: unknown): AgentStageConfig | undefined {
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    const agentName = parseAgentName(obj.agent);
    if (agentName) {
      return {
        agent: agentName,
        model: typeof obj.model === "string" ? obj.model : undefined,
      };
    }
  }
  return undefined;
}

function parseAgentName(value: unknown): AgentName | undefined {
  if (typeof value === "string" && isAgentName(value)) {
    return value;
  }
  return undefined;
}

/**
 * Get the agent configuration for a specific stage.
 * Falls back to the default config if the stage is not configured.
 */
export function getAgentConfig(config: Config, stage: AgentStage): AgentStageConfig {
  return config.agents[stage] ?? config.agents.default;
}

export function resolveWorktreesDir(repoRoot: string, config: Config): string {
  return resolve(repoRoot, config.worktrees_dir);
}
