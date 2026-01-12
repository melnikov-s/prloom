/**
 * Plugin State Storage
 *
 * Provides persistent key/value storage for plugins.
 * See RFC: docs/rfc-plugin-bridge-primitives.md
 *
 * Storage locations:
 * - Per-plan: <worktree>/prloom/.local/plugin-state/<pluginName>.json
 * - Global:   <repoRoot>/prloom/.local/plugin-state-global/<pluginName>.json
 */

import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import type { JsonValue } from "../bus/types.js";

// =============================================================================
// Per-Plan Plugin State
// =============================================================================

const PLUGIN_STATE_DIR = "prloom/.local/plugin-state";

/**
 * Get the path to a plugin's state file in a worktree.
 */
function getPluginStatePath(worktree: string, pluginName: string): string {
  return join(worktree, PLUGIN_STATE_DIR, `${pluginName}.json`);
}

/**
 * Load all state for a plugin from a worktree.
 */
function loadAllPluginState(
  worktree: string,
  pluginName: string
): Record<string, JsonValue> {
  const statePath = getPluginStatePath(worktree, pluginName);

  if (!existsSync(statePath)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(statePath, "utf-8"));
  } catch {
    return {};
  }
}

/**
 * Save all state for a plugin to a worktree.
 */
function saveAllPluginState(
  worktree: string,
  pluginName: string,
  state: Record<string, JsonValue>
): void {
  const stateDir = join(worktree, PLUGIN_STATE_DIR);
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }

  const statePath = getPluginStatePath(worktree, pluginName);
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

/**
 * Load a single value from plugin state.
 */
export function loadPluginState(
  worktree: string,
  pluginName: string,
  key: string
): JsonValue | undefined {
  const state = loadAllPluginState(worktree, pluginName);
  return state[key];
}

/**
 * Save a single value to plugin state.
 */
export function savePluginState(
  worktree: string,
  pluginName: string,
  key: string,
  value: JsonValue
): void {
  const state = loadAllPluginState(worktree, pluginName);
  state[key] = value;
  saveAllPluginState(worktree, pluginName, state);
}

// =============================================================================
// Global Plugin State (Repo-Level)
// =============================================================================

const GLOBAL_PLUGIN_STATE_DIR = "prloom/.local/plugin-state-global";

/**
 * Get the path to a plugin's global state file.
 */
function getGlobalPluginStatePath(repoRoot: string, pluginName: string): string {
  return join(repoRoot, GLOBAL_PLUGIN_STATE_DIR, `${pluginName}.json`);
}

/**
 * Load all global state for a plugin.
 */
function loadAllGlobalPluginState(
  repoRoot: string,
  pluginName: string
): Record<string, JsonValue> {
  const statePath = getGlobalPluginStatePath(repoRoot, pluginName);

  if (!existsSync(statePath)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(statePath, "utf-8"));
  } catch {
    return {};
  }
}

/**
 * Save all global state for a plugin.
 */
function saveAllGlobalPluginState(
  repoRoot: string,
  pluginName: string,
  state: Record<string, JsonValue>
): void {
  const stateDir = join(repoRoot, GLOBAL_PLUGIN_STATE_DIR);
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }

  const statePath = getGlobalPluginStatePath(repoRoot, pluginName);
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

/**
 * Load a single value from global plugin state.
 */
export function loadGlobalPluginState(
  repoRoot: string,
  pluginName: string,
  key: string
): JsonValue | undefined {
  const state = loadAllGlobalPluginState(repoRoot, pluginName);
  return state[key];
}

/**
 * Save a single value to global plugin state.
 */
export function saveGlobalPluginState(
  repoRoot: string,
  pluginName: string,
  key: string,
  value: JsonValue
): void {
  const state = loadAllGlobalPluginState(repoRoot, pluginName);
  state[key] = value;
  saveAllGlobalPluginState(repoRoot, pluginName, state);
}
