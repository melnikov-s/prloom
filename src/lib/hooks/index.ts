/**
 * Hooks Module
 *
 * Lifecycle hooks for plan execution.
 * See RFC: docs/rfc-lifecycle-hooks.md
 */

// Types
export type {
  HookPoint,
  HookContext,
  Hook,
  HookRegistry,
  PluginConfig,
  PluginFactory,
} from "./types.js";

// Loader
export { loadPlugins } from "./loader.js";

// Runner
export { runHooks, buildHookContext, type BuildHookContextOptions } from "./runner.js";
