import { join } from "path";
import { existsSync, statSync } from "fs";
import { loadConfig, resolveWorktreesDir, type Config } from "./config.js";
import {
  loadState,
  saveState,
  acquireLock,
  releaseLock,
  listInboxPlanIds,
  getInboxPath,
  deleteInboxPlan,
  type State,
  type PlanState,
} from "./state.js";
import { consume, type IpcCommand } from "./ipc.js";
import {
  parsePlan,
  findNextUnchecked,
  setStatus,
  extractBody,
} from "./plan.js";
import {
  createBranchName,
  createWorktree,
  commitAll,
  push,
  copyFileToWorktree,
  ensureWorktreeSwarmDir,
  rebaseOnBaseBranch,
  forcePush,
} from "./git.js";
import {
  createDraftPR,
  updatePRBody,
  markPRReady,
  getPRState,
  getCurrentGitHubUser,
  getPRComments,
  getPRReviews,
  getPRReviewComments,
  postPRComment,
  filterNewFeedback,
  getMaxFeedbackIds,
  type PRFeedback,
} from "./github.js";
import { getAdapter } from "./adapters/index.js";
import {
  renderWorkerPrompt,
  renderTriagePrompt,
  readTriageResultFile,
} from "./template.js";

export async function runDispatcher(repoRoot: string): Promise<void> {
  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);

  acquireLock(repoRoot);

  const cleanup = () => {
    releaseLock(repoRoot);
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  let state = loadState(repoRoot);

  // Get bot login for filtering
  let botLogin: string;
  try {
    const user = await getCurrentGitHubUser();
    botLogin = user.login;
  } catch {
    console.warn("Could not get GitHub user, bot filtering may not work");
    botLogin = "";
  }

  console.log("Dispatcher started. Press Ctrl+C to stop.");

  while (true) {
    try {
      // 1. Consume IPC commands
      const { commands, newCursor } = consume(repoRoot, state.control_cursor);
      state.control_cursor = newCursor;

      for (const cmd of commands) {
        await handleCommand(state, cmd);
      }

      // 2. Ingest inbox plans
      await ingestInboxPlans(repoRoot, worktreesDir, config, state);

      // 3. Process active plans from state
      await processActivePlans(repoRoot, config, state, botLogin);

      saveState(repoRoot, state);
      await sleepUntilIpcOrTimeout(repoRoot, state.control_cursor, config.poll_interval_ms);
    } catch (error) {
      console.error("Dispatcher error:", error);
      await sleepUntilIpcOrTimeout(repoRoot, state.control_cursor, config.poll_interval_ms);
    }
  }
}

async function ingestInboxPlans(
  repoRoot: string,
  worktreesDir: string,
  config: Config,
  state: State
): Promise<void> {
  const inboxPlanIds = listInboxPlanIds(repoRoot);

  for (const planId of inboxPlanIds) {
    const inboxPath = getInboxPath(repoRoot, planId);

    try {
      const plan = parsePlan(inboxPath);

      // Validate: frontmatter id must match filename
      if (plan.frontmatter.id !== planId) {
        console.error(
          `ID mismatch: file ${planId}.md has id: ${plan.frontmatter.id}, skipping`
        );
        continue;
      }

      console.log(`📥 Ingesting inbox plan: ${planId}`);

      // Determine base branch for this plan
      const baseBranch = plan.frontmatter.base_branch ?? config.base_branch;

      // Create branch and worktree
      const branch = await createBranchName(planId);
      const worktreePath = await createWorktree(
        repoRoot,
        worktreesDir,
        branch,
        baseBranch
      );
      const planRelpath = `plans/${planId}.md`;

      // Copy plan to worktree
      copyFileToWorktree(inboxPath, worktreePath, planRelpath);

      // Set status to active in worktree plan
      const worktreePlanPath = join(worktreePath, planRelpath);
      setStatus(worktreePlanPath, "active");

      // Commit and push
      await commitAll(worktreePath, `[swarm] ${planId}: initial plan`);
      await push(worktreePath, branch);

      // Create draft PR
      const updatedPlan = parsePlan(worktreePlanPath);
      const pr = await createDraftPR(
        repoRoot,
        branch,
        baseBranch,
        planId,
        extractBody(updatedPlan)
      );

      // Store in state
      state.plans[planId] = {
        worktree: worktreePath,
        branch,
        pr,
        paused: false,
        planRelpath,
        baseBranch,
      };

      // Delete inbox plan (not archive)
      deleteInboxPlan(repoRoot, planId);

      console.log(`✅ Ingested ${planId} → PR #${pr}`);
    } catch (error) {
      console.error(`Failed to ingest ${planId}:`, error);
    }
  }
}

export interface FeedbackPollDecision {
  shouldPoll: boolean;
  clearPollOnce: boolean;
  shouldUpdateLastPolledAt: boolean;
}

export function getFeedbackPollDecision(opts: {
  now: number;
  pollIntervalMs: number;
  lastPolledAt?: string;
  pollOnce?: boolean;
}): FeedbackPollDecision {
  const lastPolledRaw = opts.lastPolledAt ? Date.parse(opts.lastPolledAt) : 0;
  const lastPolled = Number.isFinite(lastPolledRaw) ? lastPolledRaw : 0;

  const pollOnce = opts.pollOnce === true;
  const shouldPoll = pollOnce || opts.now - lastPolled >= opts.pollIntervalMs;

  return {
    shouldPoll,
    clearPollOnce: pollOnce && shouldPoll,
    shouldUpdateLastPolledAt: !pollOnce && shouldPoll,
  };
}

async function processActivePlans(
  repoRoot: string,
  config: Config,
  state: State,
  botLogin: string
): Promise<void> {
  for (const [planId, ps] of Object.entries(state.plans)) {
    try {
      const planPath = join(ps.worktree, ps.planRelpath);

      if (!existsSync(planPath)) {
        console.warn(`Plan file not found: ${planPath}`);
        continue;
      }

      // Check PR state - remove if merged/closed
      if (ps.pr) {
        const prState = await getPRState(repoRoot, ps.pr);
        if (prState === "merged" || prState === "closed") {
          console.log(
            `PR #${ps.pr} ${prState}, removing ${planId} from active`
          );
          delete state.plans[planId];
          continue;
        }
      }

      if (ps.paused) continue;

      let plan = parsePlan(planPath);

      // Poll and triage feedback (even if status=done)
      // Throttle to avoid GitHub rate limits
      if (ps.pr) {
        const decision = getFeedbackPollDecision({
          now: Date.now(),
          pollIntervalMs: config.poll_interval_ms,
          lastPolledAt: ps.lastPolledAt,
          pollOnce: ps.pollOnce,
        });

        if (decision.shouldPoll) {
          if (decision.clearPollOnce) {
            ps.pollOnce = undefined;
          }
          const newFeedback = await pollNewFeedback(repoRoot, ps, botLogin);

          if (newFeedback.length > 0) {
            console.log(`💬 ${newFeedback.length} new feedback for ${planId}`);

            await runTriage(repoRoot, config, ps, plan, newFeedback);

            // Re-parse plan after triage may have modified it
            plan = parsePlan(planPath);

            // Update cursors to max IDs from processed feedback
            const maxIds = getMaxFeedbackIds(newFeedback);
            if (maxIds.lastIssueCommentId)
              ps.lastIssueCommentId = maxIds.lastIssueCommentId;
            if (maxIds.lastReviewId) ps.lastReviewId = maxIds.lastReviewId;
            if (maxIds.lastReviewCommentId)
              ps.lastReviewCommentId = maxIds.lastReviewCommentId;
          }

          // Only update the polling schedule timestamp on normal polling cycles.
          // For one-off polls (`swarm poll <id>`), keep schedule intact.
          if (decision.shouldUpdateLastPolledAt) {
            ps.lastPolledAt = new Date().toISOString();
          }
        }
      }

      // Execute next TODO (status = active or queued are runnable)
      if (
        plan.frontmatter.status !== "blocked" &&
        plan.frontmatter.status !== "done"
      ) {
        const todo = findNextUnchecked(plan);

        if (todo) {
          console.log(
            `🔧 Running TODO #${todo.index} for ${planId}: ${todo.text}`
          );

          const prompt = renderWorkerPrompt(repoRoot, plan, todo);
          const agentName = plan.frontmatter.agent ?? config.agents.default;
          const adapter = getAdapter(agentName);
          await adapter.execute({ cwd: ps.worktree, prompt });

          // Commit and push
          const committed = await commitAll(
            ps.worktree,
            `[swarm] ${planId}: TODO #${todo.index}`
          );
          if (committed) {
            await push(ps.worktree, ps.branch);
          }

          // Post completion comment
          if (ps.pr) {
            await postPRComment(
              repoRoot,
              ps.pr,
              `✅ Completed TODO #${todo.index}: ${todo.text}`
            );
          }

          // Re-parse and check status
          const updated = parsePlan(planPath);
          if (ps.pr) {
            await updatePRBody(repoRoot, ps.pr, extractBody(updated));
          }

          if (updated.frontmatter.status === "blocked") {
            console.log(`⚠️ Plan ${planId} is blocked`);
            ps.lastError = "Worker set status to blocked";
          }
        } else {
          // All TODOs done
          setStatus(planPath, "done");
          await commitAll(ps.worktree, `[swarm] ${planId}: done`);
          await push(ps.worktree, ps.branch);
          if (ps.pr) {
            await markPRReady(repoRoot, ps.pr);
          }
          console.log(`✅ Plan ${planId} complete, PR marked ready`);
        }
      }
    } catch (error) {
      console.error(`Error processing ${planId}:`, error);
      ps.lastError = String(error);
    }
  }
}

async function pollNewFeedback(
  repoRoot: string,
  ps: PlanState,
  botLogin: string
): Promise<PRFeedback[]> {
  if (!ps.pr) return [];

  const [comments, reviews, reviewComments] = await Promise.all([
    getPRComments(repoRoot, ps.pr),
    getPRReviews(repoRoot, ps.pr),
    getPRReviewComments(repoRoot, ps.pr),
  ]);

  const allFeedback = [...comments, ...reviews, ...reviewComments];
  const cursors = {
    lastIssueCommentId: ps.lastIssueCommentId,
    lastReviewId: ps.lastReviewId,
    lastReviewCommentId: ps.lastReviewCommentId,
  };

  return filterNewFeedback(allFeedback, cursors, botLogin);
}

async function runTriage(
  repoRoot: string,
  config: Config,
  ps: PlanState,
  plan: ReturnType<typeof parsePlan>,
  feedback: PRFeedback[]
): Promise<void> {
  // Ensure .swarm directory exists in worktree
  ensureWorktreeSwarmDir(ps.worktree);

  const triageAgent = config.agents.designer ?? config.agents.default;
  const adapter = getAdapter(triageAgent);
  const prompt = renderTriagePrompt(repoRoot, plan, feedback);

  console.log(`🔍 Running triage for ${plan.frontmatter.id}...`);
  await adapter.execute({ cwd: ps.worktree, prompt });

  // Read and process triage result
  try {
    const result = readTriageResultFile(ps.worktree);

    // Handle rebase request
    if (result.rebase_requested) {
      console.log(`  Rebase requested, rebasing on ${ps.baseBranch}...`);
      const rebaseResult = await rebaseOnBaseBranch(ps.worktree, ps.baseBranch);

      if (rebaseResult.hasConflicts) {
        const planPath = join(ps.worktree, ps.planRelpath);
        setStatus(planPath, "blocked");
        ps.lastError = `Rebase conflict: ${rebaseResult.conflictFiles?.join(
          ", "
        )}`;

        await postPRComment(
          repoRoot,
          ps.pr!,
          `⚠️ Rebase conflict detected:\n\`\`\`\n${rebaseResult.conflictFiles?.join(
            "\n"
          )}\n\`\`\`\nPlease resolve manually.`
        );
      } else if (rebaseResult.success) {
        await forcePush(ps.worktree, ps.branch);
        console.log(`  Rebased and force-pushed`);
      }
    }

    // Post triage reply
    await postPRComment(repoRoot, ps.pr!, result.reply_markdown);
    console.log(`  Posted triage reply`);

    // Commit any changes from triage
    const committed = await commitAll(
      ps.worktree,
      `[swarm] ${plan.frontmatter.id}: triage`
    );
    if (committed) {
      await push(ps.worktree, ps.branch);
    }
  } catch (error) {
    console.error(`Triage failed:`, error);
    const planPath = join(ps.worktree, ps.planRelpath);
    setStatus(planPath, "blocked");
    ps.lastError = `Triage failed: ${error}`;

    await postPRComment(
      repoRoot,
      ps.pr!,
      `⚠️ Triage failed to produce a valid result file. Human attention needed.\n\nError: ${error}`
    );
  }
}

function handleCommand(state: State, cmd: IpcCommand): void {
  const ps = state.plans[cmd.plan_id];
  if (!ps) return;

  if (cmd.type === "stop") {
    ps.paused = true;
    console.log(`⏸️ Paused ${cmd.plan_id}`);
  } else if (cmd.type === "unpause") {
    ps.paused = false;
    console.log(`▶️ Unpaused ${cmd.plan_id}`);
  } else if (cmd.type === "poll") {
    // Force a single immediate feedback poll without shifting schedule
    ps.pollOnce = true;
    console.log(`🔄 Poll once scheduled for ${cmd.plan_id}`);
  } else if (cmd.type === "launch_poll") {
    // Force immediate feedback poll AND reset schedule (poll timestamp)
    ps.lastPolledAt = undefined;
    console.log(`🔄 Launching immediate poll (reset schedule) for ${cmd.plan_id}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sleepUntilIpcOrTimeout(
  repoRoot: string,
  cursor: number,
  timeoutMs: number
): Promise<void> {
  const controlPath = join(repoRoot, ".swarm", "control.jsonl");
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (existsSync(controlPath)) {
      try {
        const stat = statSync(controlPath);
        if (stat.size > cursor) {
          return;
        }
      } catch {
        // Ignore stat errors and fall back to sleeping.
      }
    }

    const elapsed = Date.now() - started;
    const remaining = timeoutMs - elapsed;
    await sleep(Math.min(250, remaining));
  }
}
