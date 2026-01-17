/**
 * Review Provider Module
 *
 * Exports for the review provider abstraction.
 * See RFC: docs/rfc-review-providers.md
 */

// Types
export type {
  ReviewProvider,
  ReviewProviderContext,
  ReviewItem,
  ReviewConfig,
  ReviewProviderName,
  ReviewLocalConfig,
  ReviewGitHubConfig,
  ReviewCustomConfig,
  LocalReviewItem,
  LocalProviderState,
} from "./types.js";

// Local Provider
export {
  localProvider,
  parseReviewMd,
  computeItemHash,
  updateReviewMdCheckbox,
  type CheckboxMatchCriteria,
} from "./local.js";

// GitHub Provider
export { githubReviewProvider } from "./github.js";

// Registry
export {
  ReviewProviderRegistry,
  createReviewProviderRegistry,
} from "./registry.js";

// Config
export {
  parseReviewConfig,
  getActiveReviewProvider,
  deriveGitHubEnabled,
  validateReviewConfig,
  type ConfigValidationWarning,
} from "./config.js";

// Events
export { reviewItemToEvent } from "./events.js";
