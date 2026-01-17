/**
 * Plugin Loader
 *
 * Loads plugins from configuration and builds a HookRegistry.
 * See RFC: docs/rfc-lifecycle-hooks.md
 */

import { resolve, isAbsolute } from "path";
import type { Config } from "../config.js";
import type { HookPoint, Hook, HookRegistry, PluginFactory } from "./types.js";

/**
 * Load plugins from configuration and build a HookRegistry.
 *
 * @param config - The prloom config with plugins
 * @param repoRoot - Repository root for resolving relative module paths
 * @returns HookRegistry with hooks organized by hook point
 */
export async function loadPlugins(
  config: Config,
  repoRoot: string
): Promise<HookRegistry> {
  const registry: HookRegistry = {};

  // No plugins configured
  if (!config.plugins) {
    return registry;
  }

  // Load plugins in object key order
  for (const name of Object.keys(config.plugins)) {
    const pluginDef = config.plugins[name];

    // Skip if plugin not found in plugins config
    if (!pluginDef) {
      continue;
    }

    // Skip disabled plugins
    if (pluginDef.enabled === false) {
      continue;
    }

    // Resolve module path
    const modulePath = resolveModulePath(pluginDef.module, repoRoot);

    try {
      // Dynamic import the plugin module
      const pluginModule = await import(modulePath);

      // Get factory: named export (using plugin name) > default export > module itself
      let factory: PluginFactory;
      if (pluginModule[name]) {
        factory = pluginModule[name];
      } else {
        factory = pluginModule.default ?? pluginModule;
      }

      // Call factory with plugin config to get hooks
      const hooks = factory(pluginDef.config);

      // Merge hooks into registry
      for (const [hookPoint, hook] of Object.entries(hooks)) {
        const point = hookPoint as HookPoint;
        if (!registry[point]) {
          registry[point] = [];
        }
        registry[point]!.push(hook as Hook);
      }
    } catch (error) {
      throw new Error(
        `Failed to load plugin "${name}" from ${modulePath}: ${error}`
      );
    }
  }

  return registry;
}

/**
 * Resolve a module path, handling relative paths and npm packages.
 */
function resolveModulePath(modulePath: string, repoRoot: string): string {
  // Absolute paths are used as-is
  if (isAbsolute(modulePath)) {
    return modulePath;
  }

  // Relative paths are resolved from repo root
  if (modulePath.startsWith("./") || modulePath.startsWith("../")) {
    return resolve(repoRoot, modulePath);
  }

  // npm packages are imported as-is (node will resolve from node_modules)
  return modulePath;
}
