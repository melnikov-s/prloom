import { join, resolve } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { type AgentName, isAgentName } from "./adapters/index.js";

// ============================================================================
// GitHub Configuration
// ============================================================================

export interface GithubConfig {
  enabled: boolean;
}

const DEFAULT_GITHUB: GithubConfig = {
  enabled: true,
};

// ============================================================================
// Bus Configuration
// ============================================================================

export interface BusConfig {
  /** How often to tick the bus (call bridge events), in ms. Default: 1000 */
  tickIntervalMs: number;
}

const DEFAULT_BUS: BusConfig = {
  tickIntervalMs: 1000,
};

export interface BridgeConfig {
  /** Whether this bridge is enabled */
  enabled: boolean;
  /** Poll interval in ms for event polling (default: 60000 for GitHub) */
  pollIntervalMs?: number;
  /** Optional path to custom bridge module */
  module?: string;
  /** Additional freeform config properties (tokens, slugs, etc.) */
  [key: string]: unknown;
}

const DEFAULT_BRIDGES: Record<string, BridgeConfig> = {
  github: { enabled: true, pollIntervalMs: 60000 },
};

// ============================================================================
// Preset Configuration
// ============================================================================

/**
 * Partial config that can be used in presets or worktree overrides.
 * All fields are optional and will be merged with the base config.
 */
export interface PresetConfig {
  github?: Partial<GithubConfig>;
  agents?: Partial<AgentsConfig>;
  github_poll_interval_ms?: number;
  base_branch?: string;
}

export type AgentStage = "designer" | "worker" | "reviewer" | "triage";

/**
 * Model configuration for a specific agent.
 * Maps stage names to model identifiers, with a default fallback.
 */
export interface AgentModelConfig {
  default?: string;
  designer?: string;
  worker?: string;
  reviewer?: string;
  triage?: string;
}

/**
 * Agents configuration.
 * - `default`: which agent to use by default
 * - `[agentName]`: model configuration per agent
 */
export interface AgentsConfig {
  default: AgentName;
  opencode?: AgentModelConfig;
  claude?: AgentModelConfig;
  codex?: AgentModelConfig;
  gemini?: AgentModelConfig;
  manual?: AgentModelConfig;
}

/**
 * Resolved agent config for a specific stage.
 */
export interface AgentStageConfig {
  agent: AgentName;
  model?: string;
}

export interface Config {
  agents: AgentsConfig;
  github: GithubConfig;
  presets?: Record<string, PresetConfig>;
  worktrees_dir: string;
  github_poll_interval_ms: number;
  base_branch: string;
  bus: BusConfig;
  bridges: Record<string, BridgeConfig>;
}

const DEFAULTS: Config = {
  agents: {
    default: "opencode",
  },
  github: DEFAULT_GITHUB,
  worktrees_dir: "prloom/.local/worktrees",
  github_poll_interval_ms: 60000, // 60 seconds for GitHub API rate limits
  base_branch: "main",
  bus: DEFAULT_BUS,
  bridges: DEFAULT_BRIDGES,
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
    const defaultAgent =
      parseAgentName(parsed.agents?.default) ?? DEFAULTS.agents.default;

    const agents: AgentsConfig = {
      default: defaultAgent,
      opencode: parseAgentModelConfig(parsed.agents?.opencode),
      claude: parseAgentModelConfig(parsed.agents?.claude),
      codex: parseAgentModelConfig(parsed.agents?.codex),
      gemini: parseAgentModelConfig(parsed.agents?.gemini),
      manual: parseAgentModelConfig(parsed.agents?.manual),
    };

    // Parse github config
    const github: GithubConfig = {
      enabled: parsed.github?.enabled ?? DEFAULTS.github.enabled,
    };

    // Parse presets
    const presets = parsePresets(parsed.presets);

    // Parse bus config
    const bus: BusConfig = {
      tickIntervalMs: parsed.bus?.tickIntervalMs ?? DEFAULTS.bus.tickIntervalMs,
    };

    // Parse bridges config
    const bridges: Record<string, BridgeConfig> = { ...DEFAULT_BRIDGES };
    if (typeof parsed.bridges === "object" && parsed.bridges !== null) {
      for (const [name, cfg] of Object.entries(parsed.bridges)) {
        if (typeof cfg === "object" && cfg !== null) {
          const cfgObj = cfg as Record<string, unknown>;
          // Preserve all bridge config fields (enabled, module, pollIntervalMs, etc.)
          bridges[name] = {
            ...cfgObj,
            enabled: cfgObj.enabled !== false, // Default to true unless explicitly disabled
          } as BridgeConfig;
        }
      }
    }

    return {
      agents,
      github,
      presets,
      worktrees_dir: parsed.worktrees_dir ?? DEFAULTS.worktrees_dir,
      github_poll_interval_ms:
        parsed.github_poll_interval_ms ?? DEFAULTS.github_poll_interval_ms,
      base_branch:
        typeof parsed.base_branch === "string" && parsed.base_branch.trim()
          ? parsed.base_branch
          : DEFAULTS.base_branch,
      bus,
      bridges,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function parsePresets(
  value: unknown
): Record<string, PresetConfig> | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const result: Record<string, PresetConfig> = {};
  for (const [name, preset] of Object.entries(value)) {
    if (typeof preset === "object" && preset !== null) {
      result[name] = preset as PresetConfig;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function parseAgentModelConfig(value: unknown): AgentModelConfig | undefined {
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    const config: AgentModelConfig = {};

    if (typeof obj.default === "string") config.default = obj.default;
    if (typeof obj.designer === "string") config.designer = obj.designer;
    if (typeof obj.worker === "string") config.worker = obj.worker;
    if (typeof obj.reviewer === "string") config.reviewer = obj.reviewer;
    if (typeof obj.triage === "string") config.triage = obj.triage;

    // Only return if at least one model is configured
    if (Object.keys(config).length > 0) {
      return config;
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
 * Resolution order:
 * 1. Agent's stage-specific model (e.g., agents.opencode.worker)
 * 2. Agent's default model (e.g., agents.opencode.default)
 * 3. Just the agent name with no model
 */
export function getAgentConfig(
  config: Config,
  stage: AgentStage,
  agentOverride?: AgentName
): AgentStageConfig {
  const agent = agentOverride ?? config.agents.default;
  const agentModels = config.agents[agent];

  // Try stage-specific model, then default model for this agent
  const model = agentModels?.[stage] ?? agentModels?.default;

  return { agent, model };
}

export function resolveWorktreesDir(repoRoot: string, config: Config): string {
  return resolve(repoRoot, config.worktrees_dir);
}

// ============================================================================
// Deep Merge Utility
// ============================================================================

/**
 * Deep merge objects. Later objects override earlier ones.
 * Arrays are replaced, not merged.
 */
export function deepMerge(
  ...objects: (Record<string, unknown> | undefined)[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const obj of objects) {
    if (!obj) continue;

    for (const [key, value] of Object.entries(obj)) {
      if (
        value !== undefined &&
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        typeof result[key] === "object" &&
        result[key] !== null &&
        !Array.isArray(result[key])
      ) {
        // Deep merge nested objects
        result[key] = deepMerge(
          result[key] as Record<string, unknown>,
          value as Record<string, unknown>
        );
      } else if (value !== undefined) {
        // Replace value
        result[key] = value;
      }
    }
  }

  return result;
}

// ============================================================================
// Worktree Config
// ============================================================================

const WORKTREE_CONFIG_PATH = "prloom/config.json";

/**
 * Load config overrides from a worktree's local config file.
 * Returns empty object if file doesn't exist or is invalid.
 */
export function loadWorktreeConfig(worktreePath: string): PresetConfig {
  const configPath = join(worktreePath, WORKTREE_CONFIG_PATH);

  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed as PresetConfig;
  } catch {
    return {};
  }
}

/**
 * Write config overrides to a worktree's local config file.
 */
export function writeWorktreeConfig(
  worktreePath: string,
  config: PresetConfig
): void {
  const configDir = join(worktreePath, "prloom");
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  const configPath = join(worktreePath, WORKTREE_CONFIG_PATH);
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// ============================================================================
// Config Resolution
// ============================================================================

/**
 * Resolve final config by merging global config, preset, and worktree overrides.
 *
 * Resolution order:
 * 1. Global config (base)
 * 2. Preset overrides (if presetName provided and exists)
 * 3. Worktree config overrides
 */
export function resolveConfig(
  globalConfig: Config,
  presetName?: string,
  worktreeConfig?: PresetConfig
): Config {
  // Get preset overrides
  const preset =
    presetName && globalConfig.presets?.[presetName]
      ? globalConfig.presets[presetName]
      : {};

  // Merge: global → preset → worktree
  const merged = deepMerge(
    globalConfig as unknown as Record<string, unknown>,
    preset as Record<string, unknown>,
    (worktreeConfig ?? {}) as Record<string, unknown>
  );

  // Build result with proper defaults fallback
  const mergedAgents = merged.agents as AgentsConfig | undefined;
  const mergedGithub = merged.github as GithubConfig | undefined;
  const mergedBus = merged.bus as BusConfig | undefined;
  const mergedBridges = merged.bridges as
    | Record<string, BridgeConfig>
    | undefined;

  return {
    agents: mergedAgents ?? DEFAULTS.agents,
    github: mergedGithub ?? DEFAULTS.github,
    presets: merged.presets as Record<string, PresetConfig> | undefined,
    worktrees_dir: (merged.worktrees_dir as string) ?? DEFAULTS.worktrees_dir,
    github_poll_interval_ms:
      (merged.github_poll_interval_ms as number) ??
      DEFAULTS.github_poll_interval_ms,
    base_branch: (merged.base_branch as string) ?? DEFAULTS.base_branch,
    bus: mergedBus ?? DEFAULTS.bus,
    bridges: mergedBridges ?? DEFAULTS.bridges,
  };
}

/**
 * Get list of preset names from config.
 */
export function getPresetNames(config: Config): string[] {
  if (!config.presets) {
    return [];
  }
  return Object.keys(config.presets);
}
