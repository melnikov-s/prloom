import { join } from "path";
import { existsSync } from "fs";
import { loadState, listInboxPlanIds, getInboxPath } from "./state.js";
import { parsePlan } from "./plan.js";

/**
 * Resolves a user-provided input string to a unique Plan ID.
 * Supports:
 * 1. Exact Plan ID (e.g. "k7r2p")
 * 2. Full Git Branch Name (e.g. "fix-bug-x9y8z")
 * 3. Descriptive Branch Name (e.g. "fix-bug")
 *
 * If the input is ambiguous, it throws an error listing matches.
 */
export async function resolvePlanId(
  repoRoot: string,
  input: string
): Promise<string> {
  if (!input) {
    throw new Error("Plan ID or branch name is required.");
  }

  const matches = new Set<string>();
  const state = loadState(repoRoot);
  const inboxIds = listInboxPlanIds(repoRoot);

  // 1. Check for Exact ID match in inbox or state
  const exactInboxMatch = inboxIds.find(
    (id) => id === input || id.endsWith(`-${input}`)
  );
  if (exactInboxMatch || state.plans[input]) {
    matches.add(
      exactInboxMatch
        ? exactInboxMatch.split("-").pop() || exactInboxMatch
        : input
    );
  }

  // 2. Check for Exact Branch match in active state
  for (const [id, ps] of Object.entries(state.plans)) {
    if (ps.branch === input) {
      matches.add(id);
    }
  }

  // 3. Check for Descriptive Branch match in Inbox plans frontmatter
  for (const id of inboxIds) {
    try {
      const plan = parsePlan(getInboxPath(repoRoot, id));
      if (plan.frontmatter.branch === input) {
        matches.add(id);
      }
    } catch {
      // Ignore parse errors for individual plans
    }
  }

  // 4. Check for Descriptive Branch match in Active plans
  // We check the plan file in the worktree to be accurate
  for (const [id, ps] of Object.entries(state.plans)) {
    const planPath = join(ps.worktree, ps.planRelpath);
    if (existsSync(planPath)) {
      try {
        const plan = parsePlan(planPath);
        if (plan.frontmatter.branch === input) {
          matches.add(id);
        }
      } catch {
        // Ignore
      }
    }
  }

  // Decision logic
  const results = Array.from(matches);

  if (results.length === 1) {
    return results[0]!;
  }

  if (results.length > 1) {
    const list = results
      .map((id) => {
        const ps = state.plans[id];
        return ps ? `${id} (branch: ${ps.branch})` : `${id} (inbox)`;
      })
      .join("\n  - ");
    throw new Error(
      `Ambiguous plan reference "${input}". Matches multiple plans:\n  - ${list}\n\nPlease use the unique Plan ID instead.`
    );
  }

  throw new Error(
    `Plan not found: "${input}". Check "prloom status" for available plans.`
  );
}
