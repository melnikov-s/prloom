import { join, resolve } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { type AgentName, isAgentName } from "./adapters/index.js";
import { parseReviewConfig, type ReviewConfig } from "./review/index.js";

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
// Plugin Configuration
// ============================================================================

/**
 * Configuration for a plugin.
 */
export interface PluginConfig {
  /** Whether the plugin is enabled (default: true) */
  enabled?: boolean;
  /** Module path or npm package name */
  module: string;
  /** Freeform configuration passed to the plugin factory */
  config?: unknown;
}

// ============================================================================
// Preset Configuration
// ============================================================================

/**
 * Plugin override configuration for presets.
 * Allows enabling/disabling plugins or modifying their config.
 */
export interface PluginOverride {
  /** Whether the plugin is enabled (overrides plugin's enabled field) */
  enabled?: boolean;
  /** Configuration overrides (merged with plugin's config) */
  config?: unknown;
}

// ============================================================================
// Commit Review Configuration
// ============================================================================

/**
 * Configuration for the commit review gate.
 * See RFC: docs/rfc-commit-review-gate.md
 */
export interface CommitReviewConfig {
  /** Whether commit review gate is enabled (default: false) */
  enabled: boolean;
  /** Maximum review → fix cycles before blocking (default: 2) */
  maxLoops?: number;
  /** Agent to use for review (overrides default) */
  agent?: AgentName;
  /** Model to use for review */
  model?: string;
}

/**
 * Partial config that can be used in presets or worktree overrides.
 * All fields are optional and will be merged with the base config.
 */
export interface PresetConfig {
  github?: Partial<GithubConfig>;
  agents?: Partial<AgentsConfig>;
  github_poll_interval_ms?: number;
  base_branch?: string;
  /** Plugin overrides (enable/disable, config overrides) */
  plugins?: Record<string, PluginOverride>;
}

export type AgentStage = "designer" | "worker" | "triage" | "commitReview";

/**
 * Model configuration for a specific agent.
 * Maps stage names to model identifiers, with a default fallback.
 */
export interface AgentModelConfig {
  default?: string;
  designer?: string;
  worker?: string;
  triage?: string;
  commitReview?: string;
}

/**
 * Agents configuration.
 * - `default`: which agent to use by default
 * - `[agentName]`: model configuration per agent
 */
export interface AgentsConfig {
  default: AgentName;
  amp?: AgentModelConfig;
  claude?: AgentModelConfig;
  codex?: AgentModelConfig;
  gemini?: AgentModelConfig;
  opencode?: AgentModelConfig;
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
  /** Plugin configurations (order of keys determines hook execution order) */
  plugins?: Record<string, PluginConfig>;
  /** Files to copy from repo root to worktree after creation (e.g., [".env", ".env.local"]) */
  copyFiles?: string[];
  /** Shell commands to run in worktree after creation (e.g., ["npm install"]) */
  initCommands?: string[];

  // ==========================================================================
  // RFC: Global Bridges & Core Bridge
  // ==========================================================================

  /** Global bridges configured at repo level */
  globalBridges?: Record<string, BridgeConfig>;
  /** Global plugins that run at repo level (cannot be overridden by presets) */
  globalPlugins?: Record<string, PluginConfig>;

  // ==========================================================================
  // RFC: Review Providers
  // ==========================================================================

  /** Review provider configuration (replaces bridges.github for review feedback) */
  review?: ReviewConfig;

  // ==========================================================================
  // RFC: Commit Review Gate
  // ==========================================================================

  /** Commit review gate configuration (pre-commit quality gate) */
  commitReview?: CommitReviewConfig;
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
  // RFC: Commit Review Gate - disabled by default, set enabled: true to activate
  commitReview: {
    enabled: false,
    maxLoops: 2,
  },
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
      amp: parseAgentModelConfig(parsed.agents?.amp),
      claude: parseAgentModelConfig(parsed.agents?.claude),
      codex: parseAgentModelConfig(parsed.agents?.codex),
      gemini: parseAgentModelConfig(parsed.agents?.gemini),
      opencode: parseAgentModelConfig(parsed.agents?.opencode),
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

    // Parse plugins config
    const plugins = parsePlugins(parsed.plugins);

    // Parse global bridges config (RFC: Global Bridges & Core Bridge)
    let globalBridges: Record<string, BridgeConfig> | undefined;
    if (
      typeof parsed.globalBridges === "object" &&
      parsed.globalBridges !== null
    ) {
      globalBridges = {};
      for (const [name, cfg] of Object.entries(parsed.globalBridges)) {
        if (typeof cfg === "object" && cfg !== null) {
          const cfgObj = cfg as Record<string, unknown>;
          globalBridges[name] = {
            ...cfgObj,
            enabled: cfgObj.enabled !== false,
          } as BridgeConfig;
        }
      }
    }

    // Parse global plugins config (RFC: Global Bridges & Core Bridge)
    const globalPlugins = parsePlugins(parsed.globalPlugins);

    // Parse review config (RFC: Review Providers)
    const review = parseReviewConfig(parsed.review);

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
      plugins,
      globalBridges,
      globalPlugins,
      copyFiles: Array.isArray(parsed.copyFiles) ? parsed.copyFiles : undefined,
      initCommands: Array.isArray(parsed.initCommands)
        ? parsed.initCommands
        : undefined,
      review,
      commitReview: parseCommitReviewConfig(parsed.commitReview),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function parsePresets(
  value: unknown,
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

function parsePlugins(
  value: unknown,
): Record<string, PluginConfig> | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const result: Record<string, PluginConfig> = {};
  for (const [name, plugin] of Object.entries(value)) {
    if (typeof plugin === "object" && plugin !== null) {
      const pluginObj = plugin as Record<string, unknown>;
      // Validate required module field
      if (typeof pluginObj.module === "string") {
        result[name] = {
          module: pluginObj.module,
          enabled: pluginObj.enabled as boolean | undefined,
          config: pluginObj.config,
        };
      }
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Parse commit review config from raw JSON.
 * RFC: docs/rfc-commit-review-gate.md
 */
function parseCommitReviewConfig(
  value: unknown,
): CommitReviewConfig | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const obj = value as Record<string, unknown>;

  // enabled is required
  if (typeof obj.enabled !== "boolean") {
    return undefined;
  }

  return {
    enabled: obj.enabled,
    maxLoops: typeof obj.maxLoops === "number" ? obj.maxLoops : undefined,
    agent: parseAgentName(obj.agent),
    model: typeof obj.model === "string" ? obj.model : undefined,
  };
}

function parseAgentModelConfig(value: unknown): AgentModelConfig | undefined {
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    const config: AgentModelConfig = {};

    if (typeof obj.default === "string") config.default = obj.default;
    if (typeof obj.designer === "string") config.designer = obj.designer;
    if (typeof obj.worker === "string") config.worker = obj.worker;
    if (typeof obj.triage === "string") config.triage = obj.triage;
    if (typeof obj.commitReview === "string")
      config.commitReview = obj.commitReview;

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
  agentOverride?: AgentName,
): AgentStageConfig {
  // RFC: Commit Review Gate - commitReview stage can have its own agent/model in config.commitReview
  if (stage === "commitReview" && config.commitReview) {
    const agent =
      config.commitReview.agent ?? agentOverride ?? config.agents.default;
    const model =
      config.commitReview.model ??
      config.agents[agent]?.commitReview ??
      config.agents[agent]?.default;
    return { agent, model };
  }

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
          value as Record<string, unknown>,
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
  config: PresetConfig,
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
 * Merge plugin configurations with overrides from presets or worktree config.
 *
 * @param basePlugins - Original plugins from global config
 * @param overrides - Plugin overrides from preset or worktree config
 * @returns Merged plugins config
 */
function mergePluginConfigs(
  basePlugins: Record<string, PluginConfig> | undefined,
  overrides: Record<string, PluginOverride> | undefined,
): Record<string, PluginConfig> | undefined {
  if (!basePlugins) return undefined;
  if (!overrides) return basePlugins;

  const result: Record<string, PluginConfig> = {};

  for (const [name, plugin] of Object.entries(basePlugins)) {
    const override = overrides[name];
    if (!override) {
      result[name] = plugin;
      continue;
    }

    // Merge the plugin config with overrides
    result[name] = {
      ...plugin,
      // Override enabled if specified
      enabled:
        override.enabled !== undefined ? override.enabled : plugin.enabled,
      // Deep merge config if specified
      config:
        override.config !== undefined
          ? typeof plugin.config === "object" &&
            plugin.config !== null &&
            typeof override.config === "object" &&
            override.config !== null
            ? {
                ...(plugin.config as Record<string, unknown>),
                ...(override.config as Record<string, unknown>),
              }
            : override.config
          : plugin.config,
    };
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

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
  worktreeConfig?: PresetConfig,
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
    (worktreeConfig ?? {}) as Record<string, unknown>,
  );

  // Build result with proper defaults fallback
  const mergedAgents = merged.agents as AgentsConfig | undefined;
  const mergedGithub = merged.github as GithubConfig | undefined;
  const mergedBus = merged.bus as BusConfig | undefined;
  const mergedBridges = merged.bridges as
    | Record<string, BridgeConfig>
    | undefined;

  // Merge plugin configs with proper override handling
  let mergedPlugins = globalConfig.plugins;
  if (preset.plugins) {
    mergedPlugins = mergePluginConfigs(mergedPlugins, preset.plugins);
  }
  if (worktreeConfig?.plugins) {
    mergedPlugins = mergePluginConfigs(mergedPlugins, worktreeConfig.plugins);
  }

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
    plugins: mergedPlugins,
    // RFC: Review Providers - carry through from global config (not merged from presets)
    review: globalConfig.review,
    // RFC: Commit Review Gate - merged from global -> preset -> worktree
    commitReview: merged.commitReview as CommitReviewConfig | undefined,
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
