/**
 * Hooks Module
 *
 * Lifecycle hooks for plan execution.
 * See RFC: docs/rfc-lifecycle-hooks.md
 * See RFC: docs/rfc-plugin-bridge-primitives.md
 */

// Types
export type {
  HookPoint,
  HookContext,
  Hook,
  HookRegistry,
  PluginConfig,
  PluginFactory,
  BeforeTriageContext,
  DeferredEventInfo,
  ReviewSubmission,
  // RFC: Global Bridges & Core Bridge
  EventHook,
  OnEventContext,
  GlobalEventContext,
  PlanFilter,
  PlanSummary,
  PlanStatus,
} from "./types.js";

// Loader
export { loadPlugins } from "./loader.js";

// Runner
export {
  runHooks,
  buildHookContext,
  buildBeforeTriageContext,
  type BuildHookContextOptions,
  type BuildBeforeTriageContextOptions,
} from "./runner.js";

// State
export {
  loadPluginState,
  savePluginState,
  loadGlobalPluginState,
  saveGlobalPluginState,
} from "./state.js";
