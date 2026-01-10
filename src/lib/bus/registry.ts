/**
 * Bridge Registry
 *
 * Manages bridge registration and action routing.
 * See RFC: docs/rfc-file-bus.md
 */

import type { Bridge, Action, ActionResult, BridgeContext } from "./types.js";
import { hasActions, hasEvents } from "./types.js";

// =============================================================================
// Bridge Registry
// =============================================================================

export class BridgeRegistry {
  private bridges: Map<string, Bridge> = new Map();
  private targetToBridge: Map<string, Bridge> = new Map();

  /**
   * Register a bridge with the registry.
   * Validates that there are no duplicate target claims.
   *
   * @throws Error if a target is already claimed by another bridge
   */
  register(bridge: Bridge): void {
    if (this.bridges.has(bridge.name)) {
      throw new Error(`Bridge "${bridge.name}" is already registered`);
    }

    // Validate target uniqueness for bridges that handle actions
    if (hasActions(bridge)) {
      for (const target of bridge.targets) {
        const existing = this.targetToBridge.get(target);
        if (existing) {
          throw new Error(
            `Target "${target}" is already claimed by bridge "${existing.name}", ` +
              `cannot be claimed by "${bridge.name}"`
          );
        }
      }

      // Register target mappings
      for (const target of bridge.targets) {
        this.targetToBridge.set(target, bridge);
      }
    }

    this.bridges.set(bridge.name, bridge);
  }

  /**
   * Get a bridge by name.
   */
  get(name: string): Bridge | undefined {
    return this.bridges.get(name);
  }

  /**
   * Get the bridge that handles a specific target.
   * Returns undefined if no bridge claims the target.
   */
  getTargetBridge(target: string): Bridge | undefined {
    return this.targetToBridge.get(target);
  }

  /**
   * Get all registered bridges.
   */
  getAllBridges(): Bridge[] {
    return Array.from(this.bridges.values());
  }

  /**
   * Get all bridges that produce events.
   */
  getEventBridges(): Bridge[] {
    return this.getAllBridges().filter(hasEvents);
  }

  /**
   * Get all bridges that handle actions.
   */
  getActionBridges(): Bridge[] {
    return this.getAllBridges().filter(hasActions);
  }

  /**
   * Check if a target is claimed by any bridge.
   */
  hasTarget(target: string): boolean {
    return this.targetToBridge.has(target);
  }

  /**
   * Get all registered target names.
   */
  getAllTargets(): string[] {
    return Array.from(this.targetToBridge.keys());
  }
}

// =============================================================================
// Action Routing
// =============================================================================

export interface RouteActionResult {
  bridgeName: string;
  result: ActionResult;
}

/**
 * Route an action to the appropriate bridge based on its target.
 * Returns undefined if no bridge claims the target.
 */
export async function routeAction(
  registry: BridgeRegistry,
  ctx: BridgeContext,
  action: Action
): Promise<RouteActionResult | undefined> {
  const target = action.target.target;
  const bridge = registry.getTargetBridge(target);

  if (!bridge) {
    return undefined;
  }

  if (!hasActions(bridge)) {
    // This shouldn't happen if registry is used correctly
    return undefined;
  }

  const result = await bridge.actions(ctx, action);

  return {
    bridgeName: bridge.name,
    result,
  };
}

// =============================================================================
// Default Registry
// =============================================================================

let defaultRegistry: BridgeRegistry | null = null;

/**
 * Get the default global registry.
 * Creates one if it doesn't exist.
 */
export function getDefaultRegistry(): BridgeRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new BridgeRegistry();
  }
  return defaultRegistry;
}

/**
 * Reset the default registry (for testing).
 */
export function resetDefaultRegistry(): void {
  defaultRegistry = null;
}
