import { join } from "path";
import { existsSync } from "fs";
import { loadState, listInboxPlanIds } from "./state.js";

/**
 * Resolves a user-provided input string to a unique Plan ID.
 * Supports:
 * 1. Exact Plan ID (e.g. "k7r2p")
 * 2. Full Git Branch Name (e.g. "fix-bug-x9y8z")
 * 3. Branch Preference (e.g. "fix-bug") from state.json
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
  if (exactInboxMatch) {
    if (exactInboxMatch === input) {
      matches.add(input);
    } else if (exactInboxMatch.endsWith(`-${input}`)) {
      matches.add(input);
    } else {
      // Fallback for cases like branch-id where match was found by ID extraction
      matches.add(exactInboxMatch.split("-").pop() || exactInboxMatch);
    }
  } else if (state.plans[input]) {
    matches.add(input);
  }

  // 2. Check for Branch match in state (works for both preference and actual)
  for (const [id, ps] of Object.entries(state.plans)) {
    if (ps.branch === input) {
      matches.add(id);
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
