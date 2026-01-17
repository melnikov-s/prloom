/**
 * Review Provider Registry
 *
 * Registry for managing review providers.
 * See RFC: docs/rfc-review-providers.md
 */

import type { Config } from "../config.js";
import type { ReviewProvider, ReviewProviderName } from "./types.js";
import { getActiveReviewProvider } from "./config.js";
import { localProvider } from "./local.js";
import { githubReviewProvider } from "./github.js";

// =============================================================================
// Registry Implementation
// =============================================================================

export class ReviewProviderRegistry {
  private providers: Map<string, ReviewProvider> = new Map();

  register(provider: ReviewProvider): void {
    if (this.providers.has(provider.name)) {
      throw new Error(
        `Review provider '${provider.name}' is already registered`
      );
    }
    this.providers.set(provider.name, provider);
  }

  get(name: string): ReviewProvider | undefined {
    return this.providers.get(name);
  }

  list(): string[] {
    return Array.from(this.providers.keys());
  }

  getActive(config: Config): ReviewProvider | undefined {
    const activeName = getActiveReviewProvider(config);
    return this.get(activeName);
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a review provider registry with built-in providers.
 * Async to support dynamic loading of custom provider modules.
 *
 * @param config - The configuration object
 * @param repoRoot - Repository root path for resolving relative module paths
 */
export async function createReviewProviderRegistry(
  config: Config,
  repoRoot?: string
): Promise<ReviewProviderRegistry> {
  const registry = new ReviewProviderRegistry();

  // Register built-in providers
  registry.register(localProvider);
  registry.register(githubReviewProvider);

  // Load custom provider if configured
  if (config.review?.provider === "custom" && config.review.custom?.module) {
    // Use repoRoot for relative paths (consistent with bridge module loading)
    const modulePath = config.review.custom.module.startsWith("./")
      ? `${repoRoot ?? process.cwd()}/${config.review.custom.module}`
      : config.review.custom.module;

    try {
      const mod = await import(modulePath);
      const provider = mod.default ?? mod.provider;
      if (
        provider &&
        typeof provider.name === "string" &&
        typeof provider.poll === "function"
      ) {
        registry.register(provider as ReviewProvider);
      } else {
        console.warn(
          `Custom review provider module ${config.review.custom.module} does not export a valid provider`
        );
      }
    } catch (error) {
      console.warn(`Failed to load custom review provider: ${error}`);
    }
  }

  return registry;
}
