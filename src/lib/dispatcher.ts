import { join } from "path";
import { existsSync, statSync, readFileSync } from "fs";
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
  ensureWorktreePrloomDir,
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

export interface DispatcherOptions {
  /** Run workers in tmux sessions for observation */
  tmux?: boolean;
}

export async function runDispatcher(
  repoRoot: string,
  options: DispatcherOptions = {}
): Promise<void> {
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
      await processActivePlans(repoRoot, config, state, botLogin, options);

      saveState(repoRoot, state);

      // Main loop: check files every 5 seconds
      await sleepUntilIpcOrTimeout(repoRoot, state.control_cursor, 5000);
    } catch (error) {
      console.error("Dispatcher error:", error);
      await sleepUntilIpcOrTimeout(repoRoot, state.control_cursor, 5000);
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

      // Skip drafts - designer is still working on them
      if (plan.frontmatter.status === "draft") {
        continue;
      }

      console.log(`📥 Ingesting inbox plan: ${planId}`);

      // Determine base branch for this plan
      const baseBranch = plan.frontmatter.base_branch ?? config.base_branch;
      console.log(`   Base branch: ${baseBranch}`);

      // Create branch and worktree
      const branchBase =
        plan.frontmatter.branch && plan.frontmatter.branch.trim() !== ""
          ? plan.frontmatter.branch
          : planId;

      const branch = await createBranchName(branchBase);
      console.log(`   Creating branch: ${branch}`);
      const worktreePath = await createWorktree(
        repoRoot,
        worktreesDir,
        branch,
        baseBranch
      );
      console.log(`   Created worktree: ${worktreePath}`);
      const planRelpath = `prloom/plans/${planId}.md`;

      // Copy plan to worktree
      console.log(`   Copying plan to worktree: ${planRelpath}`);
      copyFileToWorktree(inboxPath, worktreePath, planRelpath);

      // Set status to active in worktree plan
      const worktreePlanPath = join(worktreePath, planRelpath);
      console.log(`   Setting plan status to: active`);
      setStatus(worktreePlanPath, "active");

      // Commit and push
      console.log(`   Committing: [prloom] ${planId}: initial plan`);
      await commitAll(worktreePath, `[prloom] ${planId}: initial plan`);
      console.log(`   Pushing branch to origin: ${branch}`);
      await push(worktreePath, branch);

      // Create draft PR
      console.log(`   Creating draft PR...`);
      const updatedPlan = parsePlan(worktreePlanPath);
      const pr = await createDraftPR(
        repoRoot,
        branch,
        baseBranch,
        planId,
        extractBody(updatedPlan)
      );
      console.log(`   Created draft PR #${pr}`);

      // Store in state
      state.plans[planId] = {
        worktree: worktreePath,
        branch,
        pr,
        planRelpath,
        baseBranch,
      };

      // Delete inbox plan (not archive)
      console.log(`   Removing plan from inbox`);
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
  botLogin: string,
  options: DispatcherOptions = {}
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

      // Skip if plan status is blocked
      let plan = parsePlan(planPath);
      if (plan.frontmatter.status === "blocked") continue;

      // Skip automated execution for manual agent plans
      const isManualAgent = plan.frontmatter.agent === "manual";

      // Poll and triage feedback (even if status=done)
      // Throttle to avoid GitHub rate limits
      if (ps.pr) {
        const decision = getFeedbackPollDecision({
          now: Date.now(),
          pollIntervalMs: config.github_poll_interval_ms,
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

            // Skip automated triage for manual agent plans
            if (!isManualAgent) {
              await runTriage(repoRoot, config, ps, plan, newFeedback, options);
            }

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
          // For one-off polls (`prloom poll <id>`), keep schedule intact.
          if (decision.shouldUpdateLastPolledAt) {
            ps.lastPolledAt = new Date().toISOString();
          }
        }
      }

      // Execute next TODO (status = active or queued are runnable)
      // Skip automated TODO execution for manual agent plans
      if (
        !isManualAgent &&
        plan.frontmatter.status !== "blocked" &&
        plan.frontmatter.status !== "done"
      ) {
        const todo = findNextUnchecked(plan);

        if (todo) {
          // Check for retry loop - same TODO being attempted again
          const MAX_TODO_RETRIES = 3;
          if (ps.lastTodoIndex === todo.index) {
            ps.todoRetryCount = (ps.todoRetryCount ?? 0) + 1;
            console.log(
              `   [retry ${ps.todoRetryCount}/${MAX_TODO_RETRIES} for TODO #${todo.index}]`
            );

            if (ps.todoRetryCount >= MAX_TODO_RETRIES) {
              console.error(
                `❌ TODO #${todo.index} failed ${MAX_TODO_RETRIES} times, blocking plan`
              );

              // Show the worker log from previous attempts
              const workerLogPath = join(
                "/tmp",
                `prloom-${planId}`,
                "worker.log"
              );
              if (existsSync(workerLogPath)) {
                console.error(`   Log file: ${workerLogPath}`);
                const log = readFileSync(workerLogPath, "utf-8");
                const lines = log.trim().split("\n").slice(-30);
                console.error(`   Last 30 lines of worker log:`);
                for (const line of lines) {
                  console.error(`     ${line}`);
                }
              } else {
                console.error(`   No worker log found at: ${workerLogPath}`);
              }

              const planPath = join(ps.worktree, ps.planRelpath);
              console.log(`   Setting plan status to: blocked`);
              setStatus(planPath, "blocked");
              ps.lastError = `TODO #${todo.index} failed after ${MAX_TODO_RETRIES} retries - worker did not mark it complete`;

              continue;
            }
          } else {
            // New TODO, reset retry counter
            ps.lastTodoIndex = todo.index;
            ps.todoRetryCount = 0;
          }

          console.log(
            `🔧 Running TODO #${todo.index} for ${planId}: ${todo.text}`
          );

          const prompt = renderWorkerPrompt(repoRoot, plan, todo);
          const agentName = plan.frontmatter.agent ?? config.agents.default;
          const adapter = getAdapter(agentName);

          // Build tmux config if enabled
          const tmuxConfig = options.tmux
            ? { sessionName: `prloom-${planId}` }
            : undefined;

          // Track session in state for prloom watch
          if (tmuxConfig) {
            ps.tmuxSession = tmuxConfig.sessionName;
            console.log(
              `   [spawned in tmux session: ${tmuxConfig.sessionName}]`
            );
          }

          const execResult = await adapter.execute({
            cwd: ps.worktree,
            prompt,
            tmux: tmuxConfig,
          });

          // Clear tmux session after completion
          if (tmuxConfig) {
            ps.tmuxSession = undefined;
          }

          // Check exit code
          if (execResult.exitCode !== 0) {
            console.warn(
              `   ⚠️ Worker exited with code ${execResult.exitCode}`
            );
          }

          // Re-parse plan to check if TODO was marked complete
          const updatedPlan = parsePlan(planPath);
          const updatedTodo = updatedPlan.todos[todo.index];

          if (!updatedTodo?.done) {
            console.warn(
              `   ⚠️ TODO #${todo.index} was NOT marked complete by worker`
            );
            console.warn(`   Exit code: ${execResult.exitCode}`);

            // Show log file location and content
            const logPath = join("/tmp", `prloom-${planId}`, "worker.log");
            if (existsSync(logPath)) {
              console.warn(`   Log file: ${logPath}`);
              const log = readFileSync(logPath, "utf-8");
              const lines = log.trim().split("\n").slice(-30);
              console.warn(`   Last 30 lines of worker log:`);
              for (const line of lines) {
                console.warn(`     ${line}`);
              }
            } else {
              console.warn(`   No worker log found at: ${logPath}`);
            }

            // Don't commit/push, let retry logic handle it on next iteration
            continue;
          }

          // TODO was completed - reset retry tracking
          ps.lastTodoIndex = undefined;
          ps.todoRetryCount = undefined;
          console.log(`   ✓ TODO #${todo.index} marked complete`);

          // Commit and push
          console.log(`   Committing: [prloom] ${planId}: TODO #${todo.index}`);
          const committed = await commitAll(
            ps.worktree,
            `[prloom] ${planId}: TODO #${todo.index}`
          );
          if (committed) {
            console.log(`   Pushing to origin: ${ps.branch}`);
            await push(ps.worktree, ps.branch);
          } else {
            console.log(`   No changes to commit`);
          }

          // Re-parse and check status
          const updated = parsePlan(planPath);
          if (ps.pr) {
            console.log(`   Updating PR #${ps.pr} body`);
            await updatePRBody(repoRoot, ps.pr, extractBody(updated));
          }

          if (updated.frontmatter.status === "blocked") {
            console.log(`⚠️ Plan ${planId} is blocked`);
            ps.lastError = "Worker set status to blocked";
          }

          // Check if all TODOs are now complete
          const remainingTodo = findNextUnchecked(updated);
          if (!remainingTodo) {
            console.log(`🎉 All TODOs complete for ${planId}`);
            // Only set status if worker didn't already set it to done
            if (updated.frontmatter.status !== "done") {
              console.log(`   Setting plan status to: done`);
              setStatus(planPath, "done");
              console.log(`   Committing: [prloom] ${planId}: done`);
              await commitAll(ps.worktree, `[prloom] ${planId}: done`);
              console.log(`   Pushing to origin: ${ps.branch}`);
              await push(ps.worktree, ps.branch);
            }
            if (ps.pr) {
              console.log(`   Marking PR #${ps.pr} as ready for review`);
              await markPRReady(repoRoot, ps.pr);
            }
            console.log(`✅ Plan ${planId} complete, PR marked ready`);
          }
        } else {
          // All TODOs done
          console.log(`🎉 All TODOs complete for ${planId}`);
          console.log(`   Setting plan status to: done`);
          setStatus(planPath, "done");
          console.log(`   Committing: [prloom] ${planId}: done`);
          await commitAll(ps.worktree, `[prloom] ${planId}: done`);
          console.log(`   Pushing to origin: ${ps.branch}`);
          await push(ps.worktree, ps.branch);
          if (ps.pr) {
            console.log(`   Marking PR #${ps.pr} as ready for review`);
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
  feedback: PRFeedback[],
  options: DispatcherOptions = {}
): Promise<void> {
  // Ensure .prloom directory exists in worktree
  ensureWorktreePrloomDir(ps.worktree);

  const triageAgent = config.agents.designer ?? config.agents.default;
  const adapter = getAdapter(triageAgent);
  const prompt = renderTriagePrompt(repoRoot, plan, feedback);

  console.log(`🔍 Running triage for ${plan.frontmatter.id}...`);
  console.log(`   Using agent: ${triageAgent}`);

  // Build tmux config if enabled
  const tmuxConfig = options.tmux
    ? { sessionName: `prloom-triage-${plan.frontmatter.id}` }
    : undefined;

  if (tmuxConfig) {
    console.log(`   Spawning in tmux session: ${tmuxConfig.sessionName}`);
  }

  await adapter.execute({ cwd: ps.worktree, prompt, tmux: tmuxConfig });
  console.log(`   Triage agent completed`);

  // Read and process triage result
  try {
    const result = readTriageResultFile(ps.worktree);

    // Handle rebase request
    if (result.rebase_requested) {
      console.log(`  Rebase requested, rebasing on ${ps.baseBranch}...`);
      const rebaseResult = await rebaseOnBaseBranch(ps.worktree, ps.baseBranch);

      if (rebaseResult.hasConflicts) {
        console.log(`   Rebase conflict detected, blocking plan`);
        const planPath = join(ps.worktree, ps.planRelpath);
        console.log(`   Setting plan status to: blocked`);
        setStatus(planPath, "blocked");
        ps.lastError = `Rebase conflict: ${rebaseResult.conflictFiles?.join(
          ", "
        )}`;

        console.log(`   Posting rebase conflict comment to PR #${ps.pr}`);
        await postPRComment(
          repoRoot,
          ps.pr!,
          `\u26a0\ufe0f **Rebase conflict detected**

The following files have conflicts:
\`\`\`
${rebaseResult.conflictFiles?.join("\n")}
\`\`\`

**To resolve:**

1. Navigate to the worktree:
   \`\`\`
   cd ${ps.worktree}
   \`\`\`

2. Fetch and rebase manually:
   \`\`\`
   git fetch origin ${ps.baseBranch}
   git rebase origin/${ps.baseBranch}
   \`\`\`

3. Resolve conflicts in your editor, then:
   \`\`\`
   git add .
   git rebase --continue
   \`\`\`

4. Force push the resolved branch:
   \`\`\`
   git push --force-with-lease
   \`\`\`

5. Unblock the plan:
   \`\`\`
   prloom unpause ${plan.frontmatter.id}
   \`\`\`

The plan is now **blocked** until conflicts are resolved.`
        );
      } else if (rebaseResult.success) {
        console.log(`   Force pushing rebased branch: ${ps.branch}`);
        await forcePush(ps.worktree, ps.branch);
        console.log(`   Rebased and force-pushed`);
      }
    }

    // Post triage reply
    console.log(`   Posting triage reply to PR #${ps.pr}`);
    await postPRComment(repoRoot, ps.pr!, result.reply_markdown);
    console.log(`   Posted triage reply`);

    // Commit any changes from triage
    console.log(`   Committing: [prloom] ${plan.frontmatter.id}: triage`);
    const committed = await commitAll(
      ps.worktree,
      `[prloom] ${plan.frontmatter.id}: triage`
    );
    if (committed) {
      console.log(`   Pushing to origin: ${ps.branch}`);
      await push(ps.worktree, ps.branch);
    } else {
      console.log(`   No changes to commit from triage`);
    }
  } catch (error) {
    console.error(`   Triage failed:`, error);
    const planPath = join(ps.worktree, ps.planRelpath);
    console.log(`   Setting plan status to: blocked`);
    setStatus(planPath, "blocked");
    ps.lastError = `Triage failed: ${error}`;

    console.log(`   Posting triage error comment to PR #${ps.pr}`);
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
    // Block the plan
    const planPath = join(ps.worktree, ps.planRelpath);
    console.log(`⏹️ Stopping ${cmd.plan_id}`);
    console.log(`   Setting plan status to: blocked`);
    setStatus(planPath, "blocked");
    console.log(`   Plan blocked`);
  } else if (cmd.type === "unpause") {
    // Unblock the plan
    const planPath = join(ps.worktree, ps.planRelpath);
    console.log(`▶️ Unpausing ${cmd.plan_id}`);
    console.log(`   Setting plan status to: active`);
    setStatus(planPath, "active");
    // Reset retry counter when unblocking
    ps.lastTodoIndex = undefined;
    ps.todoRetryCount = undefined;
    console.log(`   Plan unblocked, retry counter reset`);
  } else if (cmd.type === "poll") {
    // Force a single immediate feedback poll without shifting schedule
    ps.pollOnce = true;
    console.log(`🔄 Poll once scheduled for ${cmd.plan_id}`);
  } else if (cmd.type === "launch_poll") {
    // Force immediate feedback poll AND reset schedule (poll timestamp)
    ps.lastPolledAt = undefined;
    console.log(
      `🔄 Launching immediate poll (reset schedule) for ${cmd.plan_id}`
    );
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
  const controlPath = join(repoRoot, ".prloom", "control.jsonl");
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
