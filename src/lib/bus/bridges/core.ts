/**
 * Core Bridge (prloom-core)
 *
 * Built-in outbound-only bridge that handles plan lifecycle actions.
 * See RFC: docs/rfc-global-bridge-and-core.md
 */

import { join } from "path";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from "fs";
import { randomUUID } from "crypto";
import type {
  OutboundBridge,
  BridgeContext,
  Action,
  ActionResult,
  UpsertPlanSource,
} from "../types.js";
import {
  loadState,
  saveState,
  ensureInboxDir,
  findPlanBySource,
  type PlanState,
  type PlanSource,
} from "../../state.js";

// =============================================================================
// Core Bridge Definition
// =============================================================================

/**
 * The prloom-core bridge handles plan lifecycle actions.
 * This is an outbound-only bridge - it has no events() method.
 */
export const coreBridge: OutboundBridge = {
  name: "prloom-core",
  targets: ["prloom-core"],

  async actions(ctx: BridgeContext, action: Action): Promise<ActionResult> {
    const payload = action.payload;

    if (payload.type !== "upsert_plan") {
      return {
        success: false,
        error: `Unknown action type: ${payload.type}`,
        retryable: false,
      };
    }

    return handleUpsertPlan(ctx, action.id, payload);
  },
};

// =============================================================================
// upsert_plan Handler
// =============================================================================

interface UpsertPlanPayload {
  type: "upsert_plan";
  source: UpsertPlanSource;
  title?: string;
  planMarkdown?: string;
  metadata?: Record<string, unknown>;
  status?: "draft" | "queued";
  hidden?: boolean;
}

async function handleUpsertPlan(
  ctx: BridgeContext,
  actionId: string,
  payload: UpsertPlanPayload
): Promise<ActionResult> {
  const { source, title, planMarkdown, status, hidden, metadata } = payload;

  // Validate source
  if (!source || !source.system || !source.kind || !source.id) {
    return {
      success: false,
      error: "upsert_plan requires source with system, kind, and id",
      retryable: false,
    };
  }

  // Validate planMarkdown for creation
  if (!planMarkdown) {
    return {
      success: false,
      error: "upsert_plan requires planMarkdown",
      retryable: false,
    };
  }

  ctx.log.info(
    `Processing upsert_plan for ${source.system}:${source.kind}:${source.id}`
  );

  try {
    // Search for existing plan by source
    const existing = findPlanBySource(ctx.repoRoot, source as PlanSource);

    if (existing) {
      return updateExistingPlan(ctx, existing, payload);
    } else {
      return createNewPlan(ctx, payload);
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    ctx.log.error(`upsert_plan failed: ${error}`);
    return {
      success: false,
      error,
      retryable: true,
    };
  }
}

/**
 * Update an existing plan (in inbox or worktree).
 */
function updateExistingPlan(
  ctx: BridgeContext,
  existing: { planId: string; state: PlanState },
  payload: UpsertPlanPayload
): ActionResult {
  const { planId, state: planState } = existing;
  const { planMarkdown, hidden, title, metadata } = payload;

  if (planState.worktree) {
    // Plan is active in a worktree
    const planPath = join(planState.worktree, "prloom", ".local", "plan.md");
    if (planMarkdown) {
      writeFileSync(planPath, planMarkdown);
    }

    // Update worktree state.json with new metadata
    const stateJsonPath = join(
      planState.worktree,
      "prloom",
      ".local",
      "state.json"
    );
    if (existsSync(stateJsonPath)) {
      const worktreeState = JSON.parse(readFileSync(stateJsonPath, "utf-8"));
      if (hidden !== undefined) worktreeState.hidden = hidden;
      if (metadata)
        worktreeState.metadata = { ...worktreeState.metadata, ...metadata };
      writeFileSync(stateJsonPath, JSON.stringify(worktreeState, null, 2));
    }

    ctx.log.info(`Updated active plan ${planId} in worktree`);
  } else {
    // Plan is in inbox
    ensureInboxDir(ctx.repoRoot);
    const inboxDir = join(ctx.repoRoot, "prloom", ".local", "inbox");
    const planPath = join(inboxDir, `${planId}.md`);
    const metaPath = join(inboxDir, `${planId}.json`);

    if (planMarkdown) {
      writeFileSync(planPath, planMarkdown);
    }

    // Update metadata
    let existingMeta: Record<string, unknown> = {};
    if (existsSync(metaPath)) {
      try {
        existingMeta = JSON.parse(readFileSync(metaPath, "utf-8"));
      } catch {
        // Ignore parse errors
      }
    }

    const updatedMeta = {
      ...existingMeta,
      status: planState.status,
      source: payload.source,
      ...(hidden !== undefined && { hidden }),
      ...(metadata && {
        metadata: {
          ...(existingMeta.metadata as Record<string, unknown>),
          ...metadata,
        },
      }),
    };
    writeFileSync(metaPath, JSON.stringify(updatedMeta, null, 2));

    ctx.log.info(`Updated inbox plan ${planId}`);
  }

  return { success: true };
}

/**
 * Create a new plan in the inbox.
 */
function createNewPlan(
  ctx: BridgeContext,
  payload: UpsertPlanPayload
): ActionResult {
  const { source, title, planMarkdown, status, hidden, metadata } = payload;

  // Generate plan ID from title or source
  const planId = generatePlanId(ctx.repoRoot, title, source);

  ensureInboxDir(ctx.repoRoot);
  const inboxDir = join(ctx.repoRoot, "prloom", ".local", "inbox");
  const planPath = join(inboxDir, `${planId}.md`);
  const metaPath = join(inboxDir, `${planId}.json`);

  // Write plan markdown
  writeFileSync(planPath, planMarkdown || "");

  // Write metadata
  const meta: Record<string, unknown> = {
    status: status || "draft",
    source,
    ...(hidden !== undefined && { hidden }),
    ...(metadata && { metadata }),
  };
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  ctx.log.info(`Created new inbox plan ${planId}`);

  return { success: true };
}

/**
 * Generate a unique plan ID.
 */
function generatePlanId(
  repoRoot: string,
  title: string | undefined,
  source: UpsertPlanSource
): string {
  // Generate base ID from title or source
  let baseId: string;
  if (title) {
    baseId = slugify(title);
  } else {
    baseId = `${source.system}-${source.kind}-${source.id}`;
  }

  // Ensure uniqueness
  const inboxDir = join(repoRoot, "prloom", ".local", "inbox");
  if (!existsSync(inboxDir)) {
    return baseId;
  }

  const existingFiles = readdirSync(inboxDir).filter((f) => f.endsWith(".md"));
  const existingIds = new Set(existingFiles.map((f) => f.replace(/\.md$/, "")));

  if (!existingIds.has(baseId)) {
    return baseId;
  }

  // Append suffix for uniqueness
  let counter = 2;
  while (existingIds.has(`${baseId}-${counter}`)) {
    counter++;
  }

  return `${baseId}-${counter}`;
}

/**
 * Convert a title to a URL-friendly slug.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

/**
 * Get the core bridge instance.
 * Used by the global bus runner.
 */
export function getCoreBridge(): OutboundBridge {
  return coreBridge;
}
