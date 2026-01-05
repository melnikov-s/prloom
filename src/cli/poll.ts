import { join } from "path";
import { existsSync } from "fs";
import { loadState } from "../lib/state.js";
import { parsePlan } from "../lib/plan.js";
import {
  getPRComments,
  getPRReviews,
  getPRReviewComments,
  getCurrentGitHubUser,
  isBotFeedback,
  type PRFeedback,
} from "../lib/github.js";

export async function runPoll(repoRoot: string, planId: string): Promise<void> {
  const state = loadState(repoRoot);
  const ps = state.plans[planId];

  if (!ps) {
    console.error(`Plan not found: ${planId}`);
    console.error("");
    console.error("Hint: Run 'prloom status' to see active plans.");
    process.exit(1);
  }

  if (!ps.pr) {
    console.log(`No PR associated with plan: ${planId}`);
    console.log("");
    console.log("Hint: The plan may still be in the inbox awaiting dispatch.");
    return;
  }

  const planPath = join(ps.worktree, ps.planRelpath);
  if (!existsSync(planPath)) {
    console.error(`Plan file not found: ${planPath}`);
    process.exit(1);
  }

  const plan = parsePlan(planPath);

  console.log(`PR FEEDBACK: ${planId}`);
  console.log(`PR #${ps.pr} | Status: ${plan.frontmatter.status}`);
  console.log("─".repeat(60));

  // Get authenticated user to filter bot comments
  let botLogin = "";
  try {
    const user = await getCurrentGitHubUser();
    botLogin = user.login;
  } catch {
    // Continue without bot filtering
  }

  // Fetch all feedback
  const [comments, reviews, reviewComments] = await Promise.all([
    getPRComments(repoRoot, ps.pr),
    getPRReviews(repoRoot, ps.pr),
    getPRReviewComments(repoRoot, ps.pr),
  ]);

  const allFeedback = [...comments, ...reviews, ...reviewComments]
    .filter((f) => !isBotFeedback(f, botLogin))
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

  if (allFeedback.length === 0) {
    console.log("");
    console.log("No feedback from reviewers yet.");
    console.log("");
    console.log("NEXT STEPS:");
    console.log("  Continue working on TODOs in the plan.");
    console.log("");
    console.log(`Plan: ${planPath}`);
    return;
  }

  console.log("");

  for (const f of allFeedback) {
    const date = new Date(f.createdAt).toLocaleDateString();
    const typeLabel = formatFeedbackType(f);

    console.log(`[${date}] ${f.author} (${typeLabel})`);

    if (f.path) {
      console.log(`  File: ${f.path}${f.line ? `:${f.line}` : ""}`);
    }

    if (f.body.trim()) {
      const indentedBody = f.body
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n");
      console.log(indentedBody);
    }

    console.log("");
  }

  console.log("─".repeat(60));
  console.log("");
  console.log("NEXT STEPS:");
  console.log("  1. Review the feedback above");
  console.log("  2. Add new TODO items to the plan if needed");
  console.log("  3. Implement fixes in the worktree");
  console.log("  4. Commit and push changes");
  console.log("");
  console.log(`Worktree: ${ps.worktree}`);
  console.log(`Plan:     ${planPath}`);
}

function formatFeedbackType(f: PRFeedback): string {
  if (f.type === "review") {
    return f.reviewState?.toLowerCase() || "review";
  }
  if (f.type === "review_comment") {
    return "inline comment";
  }
  return "comment";
}
