import { join } from "path";
import { existsSync, statSync, readFileSync } from "fs";
import {
  loadConfig,
  resolveWorktreesDir,
  getAgentConfig,
  type Config,
} from "./config.js";
import {
  loadState,
  saveState,
  acquireLock,
  releaseLock,
  listInboxPlanIds,
  getInboxPath,
  deleteInboxPlan,
  deleteInboxMeta,
  type State,
  type PlanState,
} from "./state.js";
import { consume, getControlPath, type IpcCommand } from "./ipc.js";
import { parsePlan, findNextUnchecked, extractBody } from "./plan.js";
import {
  createBranchName,
  createWorktree,
  commitAll,
  commitEmpty,
  push,
  copyFileToWorktree,
  ensureWorktreePrloomDir,
  rebaseOnBaseBranch,
  forcePush,
  getGitHubRepoUrl,
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
  submitPRReview,
  type PRFeedback,
} from "./github.js";
import { getAdapter } from "./adapters/index.js";
import {
  isProcessAlive,
  killProcess,
  waitForProcess,
} from "./adapters/process.js";
import {
  waitForExitCodeFile,
  readExecutionResult,
  hasTmux,
} from "./adapters/tmux.js";
import {
  renderWorkerPrompt,
  renderTriagePrompt,
  readTriageResultFile,
  renderReviewPrompt,
  readReviewResultFile,
} from "./template.js";
import { dispatcherEvents } from "./events.js";

export interface DispatcherOptions {
  /** Run workers in tmux sessions for observation */
  tmux?: boolean;
  /** Use TUI instead of console output */
  useTUI?: boolean;
}

export type Logger = {
  info: (msg: string, planId?: string) => void;
  success: (msg: string, planId?: string) => void;
  warn: (msg: string, planId?: string) => void;
  error: (msg: string, planId?: string) => void;
};

/**
 * PlanState with required activation fields.
 * Used for functions that only work on plans that have been activated (not draft/queued).
 */
export type ActivatedPlanState = PlanState & {
  worktree: string;
  branch: string;
  planRelpath: string;
  baseBranch: string;
  status: "active" | "review" | "reviewing" | "triaging" | "done";
};

// Logger that routes to TUI events or console
function createLogger(useTUI: boolean) {
  return {
    info: (msg: string, planId?: string) => {
      if (useTUI) {
        dispatcherEvents.info(msg, planId);
      } else {
        console.log(msg);
      }
    },
    success: (msg: string, planId?: string) => {
      if (useTUI) {
        dispatcherEvents.success(msg, planId);
      } else {
        console.log(msg);
      }
    },
    warn: (msg: string, planId?: string) => {
      if (useTUI) {
        dispatcherEvents.warn(msg, planId);
      } else {
        console.warn(msg);
      }
    },
    error: (msg: string, planId?: string) => {
      if (useTUI) {
        dispatcherEvents.error(msg, planId);
      } else {
        console.error(msg);
      }
    },
  };
}

export async function runDispatcher(
  repoRoot: string,
  options: DispatcherOptions = {}
): Promise<void> {
  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  const log = createLogger(options.useTUI ?? false);

  acquireLock(repoRoot);

  const cleanup = () => {
    releaseLock(repoRoot);
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  let state = loadState(repoRoot);

  // Emit initial state for TUI
  if (options.useTUI) {
    dispatcherEvents.start();
    dispatcherEvents.setState(state);
    // Fetch repo URL for PR links
    const repoUrl = await getGitHubRepoUrl(repoRoot);
    dispatcherEvents.setRepoUrl(repoUrl);
  }

  // Get bot login for filtering
  let botLogin: string;
  try {
    const user = await getCurrentGitHubUser();
    botLogin = user.login;
  } catch {
    log.warn("Could not get GitHub user, bot filtering may not work");
    botLogin = "";
  }

  log.info("Dispatcher started. Press Ctrl+C to stop.");

  while (true) {
    try {
      // Reload state from disk to pick up external changes (e.g., UI changing plan status)
      const diskState = loadState(repoRoot);
      // Merge: keep in-memory plans with session tracking, but reload status changes from disk
      for (const [id, diskPs] of Object.entries(diskState.plans)) {
        if (!state.plans[id]) {
          // New plan from disk (e.g., external queue command)
          state.plans[id] = diskPs;
        } else if (
          diskPs.status === "queued" &&
          state.plans[id].status === "draft"
        ) {
          // Plan was queued externally
          state.plans[id].status = "queued";
        }
      }
      // Merge control_cursor (take the max to not re-process commands)
      state.control_cursor = Math.max(
        state.control_cursor,
        diskState.control_cursor
      );

      // 1. Consume IPC commands
      const { commands, newCursor } = consume(repoRoot, state.control_cursor);
      state.control_cursor = newCursor;

      for (const cmd of commands) {
        handleCommand(state, cmd, log);
      }

      // 2. Ingest inbox plans
      await ingestInboxPlans(
        repoRoot,
        worktreesDir,
        config,
        state,
        log,
        options
      );

      // 3. Process active plans from state
      await processActivePlans(repoRoot, config, state, botLogin, options, log);

      saveState(repoRoot, state);

      // Emit updated state for TUI
      if (options.useTUI) {
        dispatcherEvents.setState(state);
      }

      // Main loop: check files every 5 seconds
      await sleepUntilIpcOrTimeout(repoRoot, state.control_cursor, 5000);
    } catch (error) {
      log.error(`Dispatcher error: ${error}`);

      await sleepUntilIpcOrTimeout(repoRoot, state.control_cursor, 5000);
    }
  }
}

export async function ingestInboxPlans(
  repoRoot: string,
  worktreesDir: string,
  config: Config,
  state: State,
  log: Logger,
  options: DispatcherOptions = {}
): Promise<void> {
  const inboxPlanIds = listInboxPlanIds(repoRoot);

  for (const planId of inboxPlanIds) {
    const inboxPath = getInboxPath(repoRoot, planId);

    try {
      const plan = parsePlan(inboxPath);

      // Plan ID is the filename (no frontmatter needed)
      const actualId = planId;

      // Auto-discovery: Ensure plan exists in state.plans
      if (!state.plans[actualId]) {
        state.plans[actualId] = { status: "draft" };
      }

      const planMeta = state.plans[actualId]!;

      // Skip drafts - designer is still working on them
      // Status is now tracked in state.plans
      if (planMeta.status !== "queued") {
        continue;
      }

      // Skip ingestion if no TODOs found - prevents immediate completion loop
      if (plan.todos.length === 0) {
        log.error(
          `⚠️ Plan ${actualId} has zero TODO items, skipping ingestion. Please add at least one task.`
        );
        continue;
      }

      log.info(`📥 Ingesting inbox plan: ${actualId} (from ${planId}.md)`);

      // Determine base branch for this plan (from state, falls back to config)
      const baseBranch = planMeta.baseBranch ?? config.base_branch;
      log.info(`   Base branch: ${baseBranch}`);

      // Create branch and worktree
      // Use branch from state if set, otherwise use plan ID
      const branchBase =
        planMeta.branch && planMeta.branch.trim() !== ""
          ? planMeta.branch
          : actualId;

      const desiredBranch = await createBranchName(branchBase);
      log.info(`   Creating branch: ${desiredBranch}`);
      const { worktreePath, branch } = await createWorktree(
        repoRoot,
        worktreesDir,
        desiredBranch,
        baseBranch
      );
      if (branch !== desiredBranch) {
        log.info(
          `   Branch name adjusted to: ${branch} (original already existed)`
        );
      }
      log.info(`   Created worktree: ${worktreePath}`);

      // Plan stays in .local/ - not committed to repo
      // Copy to worktree's local dir for worker access
      const planRelpath = `prloom/.local/plan.md`;
      log.info(`   Copying plan to worktree local: ${planRelpath}`);
      copyFileToWorktree(inboxPath, worktreePath, planRelpath);

      // Create empty initial commit and push to create PR
      const worktreePlanPath = join(worktreePath, planRelpath);
      const planForPR = parsePlan(worktreePlanPath);
      const prTitle = planForPR.title || actualId;
      log.info(`   Creating initial commit: ${prTitle}`);
      await commitEmpty(
        worktreePath,
        `${prTitle}\n\n${extractBody(planForPR)}`
      );
      log.info(`   Pushing branch to origin: ${branch}`);
      await push(worktreePath, branch);

      // Create draft PR
      log.info(`   Creating draft PR...`);
      const pr = await createDraftPR(
        repoRoot,
        branch,
        baseBranch,
        prTitle,
        extractBody(planForPR)
      );
      log.info(`   Created draft PR #${pr}`);

      // Update plan state with active status and activation fields
      state.plans[actualId] = {
        ...state.plans[actualId],
        agent: planMeta?.agent ?? state.plans[actualId]?.agent,
        worktree: worktreePath,
        branch,
        pr,
        planRelpath,
        baseBranch,
        status: "active",
      };

      // Emit state update immediately so TUI shows the plan
      if (options.useTUI) {
        dispatcherEvents.setState(state);
      }

      // Delete inbox plan file (plan is now in state.plans with full metadata)
      log.info(`   Removing plan from inbox`);
      deleteInboxPlan(repoRoot, planId);

      log.success(`✅ Ingested ${actualId} → PR #${pr}`);
    } catch (error) {
      log.error(
        `❌ Failed to ingest plan ${planId}: ${
          error instanceof Error ? error.message : error
        }`
      );
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
  const lastPolledAt = opts.lastPolledAt;
  const lastPolledRaw = lastPolledAt ? Date.parse(lastPolledAt) : 0;
  const lastPolled = Number.isFinite(lastPolledRaw) ? lastPolledRaw : 0;

  const pollOnce = opts.pollOnce === true;
  const shouldPoll = pollOnce || opts.now - lastPolled >= opts.pollIntervalMs;

  return {
    shouldPoll,
    clearPollOnce: pollOnce && shouldPoll,
    shouldUpdateLastPolledAt: !pollOnce && shouldPoll,
  };
}

export async function processActivePlans(
  repoRoot: string,
  config: Config,
  state: State,
  botLogin: string,
  options: DispatcherOptions = {},
  log: Logger
): Promise<void> {
  for (const [planId, ps] of Object.entries(state.plans)) {
    try {
      // Skip draft/queued plans - they haven't been activated yet (no worktree)
      if (ps.status === "draft" || ps.status === "queued") {
        continue;
      }

      // Activated plans must have worktree and planRelpath
      if (!ps.worktree || !ps.planRelpath) {
        log.warn(
          `Plan ${planId} missing worktree or planRelpath, skipping`,
          planId
        );
        continue;
      }

      const planPath = join(ps.worktree, ps.planRelpath);

      if (!existsSync(planPath)) {
        log.warn(`Plan file not found: ${planPath}`, planId);
        continue;
      }

      // Check PR state - remove if merged/closed
      if (ps.pr) {
        const prState = await getPRState(repoRoot, ps.pr);
        if (prState === "merged" || prState === "closed") {
          log.info(
            `PR #${ps.pr} ${prState}, removing ${planId} from active`,
            planId
          );
          delete state.plans[planId];
          continue;
        }
      }

      // Skip if plan is blocked, reviewing, or triaging
      let plan = parsePlan(planPath);
      if (ps.blocked || ps.status === "reviewing" || ps.status === "triaging") {
        continue;
      }

      // Skip automated execution for manual agent plans
      const isManualAgent = ps.agent === "manual";

      // Handle pending review request (only valid when status is "review")
      if (ps.pendingReview && ps.status === "review") {
        ps.pendingReview = undefined;
        await runReviewAgent(
          repoRoot,
          config,
          ps as ActivatedPlanState,
          planId,
          plan,
          options,
          log
        );
        // Re-parse plan in case review agent modified it
        plan = parsePlan(planPath);
        // Skip the rest of processing for this iteration
        continue;
      }

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
          log.info(`🔄 Polling for new comments on ${planId}`, planId);
          const newFeedback = await pollNewFeedback(repoRoot, ps, botLogin);

          if (newFeedback.length > 0) {
            log.info(
              `💬 ${newFeedback.length} new feedback for ${planId}`,
              planId
            );

            // Skip automated triage for manual agent plans
            if (!isManualAgent) {
              await runTriage(
                repoRoot,
                config,
                ps as ActivatedPlanState,
                planId,
                plan,
                newFeedback,
                options,
                log
              );
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
          } else {
            log.info(`✓ No new comments found for ${planId}`, planId);
          }

          // Only update the polling schedule timestamp on normal polling cycles.
          // For one-off polls (`prloom poll <id>`), keep schedule intact.
          if (decision.shouldUpdateLastPolledAt) {
            ps.lastPolledAt = new Date().toISOString();
          }
        }
      }

      // Execute next TODO (only if status is active)
      // Skip automated TODO execution for manual agent plans
      const nextTodo = findNextUnchecked(plan);

      // If we find unchecked TODOs but status is review/done, flip back to active
      if (nextTodo && (ps.status === "review" || ps.status === "done")) {
        log.info(
          `🔄 New TODOs found, flipping ${planId} back to active`,
          planId
        );
        ps.status = "active";
      }

      if (!isManualAgent && ps.status === "active") {
        const todo = nextTodo;

        if (todo) {
          // If the task is explicitly marked as blocked, stop here
          if (todo.blocked) {
            log.error(
              `❌ Plan ${planId} is blocked by task #${todo.index + 1}: ${
                todo.text
              }`,
              planId
            );
            ps.blocked = true;
            ps.lastError = `Blocked by task #${todo.index + 1}: ${todo.text}`;
            continue;
          }

          // Check for retry loop - same TODO being attempted again
          const MAX_TODO_RETRIES = 3;
          if (ps.lastTodoIndex === todo.index) {
            ps.todoRetryCount = (ps.todoRetryCount ?? 0) + 1;
            log.info(
              `   [retry ${ps.todoRetryCount}/${MAX_TODO_RETRIES} for TODO #${
                todo.index + 1
              }]`,
              planId
            );

            if (ps.todoRetryCount >= MAX_TODO_RETRIES) {
              log.error(
                `❌ TODO #${
                  todo.index + 1
                } failed ${MAX_TODO_RETRIES} times, blocking plan`,
                planId
              );

              // Show the worker log from previous attempts
              const workerLogPath = join(
                "/tmp",
                `prloom-${planId}`,
                "worker.log"
              );
              if (existsSync(workerLogPath)) {
                log.error(`   Log file: ${workerLogPath}`, planId);
                const workerLogContent = readFileSync(workerLogPath, "utf-8");
                const lines = workerLogContent.trim().split("\n").slice(-30);
                log.error(`   Last 30 lines of worker log:`, planId);
                for (const line of lines) {
                  log.error(`     ${line}`, planId);
                }
              } else {
                log.error(
                  `   No worker log found at: ${workerLogPath}`,
                  planId
                );
              }

              log.info(`   Blocking plan`, planId);
              ps.blocked = true;
              ps.lastError = `TODO #${
                todo.index + 1
              } failed after ${MAX_TODO_RETRIES} retries - worker did not mark it complete`;

              continue;
            }
          } else {
            // New TODO, reset retry counter
            ps.lastTodoIndex = todo.index;
            ps.todoRetryCount = 0;
          }

          log.info(
            `🔧 Running TODO #${todo.index + 1} for ${planId}: ${todo.text}`,
            planId
          );

          const prompt = renderWorkerPrompt(repoRoot, plan, todo);
          const workerConfig = getAgentConfig(config, "worker", ps.agent);
          const adapter = getAdapter(workerConfig.agent);

          // Build tmux config if available and not explicitly disabled
          const useTmux = options.tmux !== false && (await hasTmux());
          const tmuxConfig = useTmux
            ? { sessionName: `prloom-${planId}` }
            : undefined;

          const execResult = await adapter.execute({
            cwd: ps.worktree,
            prompt,
            tmux: tmuxConfig,
            model: workerConfig.model,
          });

          // Store session identifiers for tracking
          if (execResult.tmuxSession) {
            ps.tmuxSession = execResult.tmuxSession;
            log.info(
              `   [spawned in tmux session: ${execResult.tmuxSession}]`,
              planId
            );
          } else if (execResult.pid) {
            ps.pid = execResult.pid;
            log.info(
              `   [spawned detached process: ${execResult.pid}]`,
              planId
            );
          }

          // Poll for completion
          if (execResult.tmuxSession) {
            await waitForExitCodeFile(execResult.tmuxSession);
            const tmuxResult = readExecutionResult(execResult.tmuxSession);
            if (tmuxResult.exitCode !== 0) {
              log.warn(
                `   ⚠️ Worker exited with code ${tmuxResult.exitCode}`,
                planId
              );
            }
          } else if (execResult.pid) {
            await waitForProcess(execResult.pid);
            log.info(`   Process ${execResult.pid} completed`, planId);
          } else if (
            execResult.exitCode !== undefined &&
            execResult.exitCode !== 0
          ) {
            // Synchronous execution with error (e.g., failed to spawn)
            log.warn(
              `   ⚠️ Worker exited with code ${execResult.exitCode}`,
              planId
            );
          }

          // Clear session identifiers after completion
          ps.tmuxSession = undefined;
          ps.pid = undefined;

          // Re-parse plan to check if TODO was marked complete
          const updatedPlan = parsePlan(planPath);
          const updatedTodo = updatedPlan.todos[todo.index];

          if (!updatedTodo?.done) {
            log.warn(
              `   ⚠️ TODO #${todo.index + 1} was NOT marked complete by worker`,
              planId
            );
            log.warn(`   Exit code: ${execResult.exitCode}`, planId);

            // Show log file location and content
            const logPath = join("/tmp", `prloom-${planId}`, "worker.log");
            if (existsSync(logPath)) {
              log.warn(`   Log file: ${logPath}`, planId);
              const workerLogContent = readFileSync(logPath, "utf-8");
              const lines = workerLogContent.trim().split("\n").slice(-30);
              log.warn(`   Last 30 lines of worker log:`, planId);
              for (const line of lines) {
                log.warn(`     ${line}`, planId);
              }
            } else {
              log.warn(`   No worker log found at: ${logPath}`, planId);
            }

            // Don't commit/push, let retry logic handle it on next iteration
            continue;
          }

          // TODO was completed - reset retry tracking
          ps.lastTodoIndex = undefined;
          ps.todoRetryCount = undefined;
          log.success(`   ✓ TODO #${todo.index + 1} marked complete`, planId);

          // Commit and push
          log.info(`   Committing: ${todo.text}`, planId);
          const committed = await commitAll(ps.worktree, todo.text);
          if (committed && ps.branch) {
            log.info(`   Pushing to origin: ${ps.branch}`, planId);
            await push(ps.worktree, ps.branch);
          } else if (committed) {
            log.warn(`   No branch set, skipping push`, planId);
          } else {
            log.info(`   No changes to commit`, planId);
          }

          // Re-parse and check status
          const updated = parsePlan(planPath);
          if (ps.pr) {
            log.info(`   Updating PR #${ps.pr} body`, planId);
            await updatePRBody(repoRoot, ps.pr, extractBody(updated));
          }

          // Check if all TODOs are now complete
          const remainingTodo = findNextUnchecked(updated);
          if (!remainingTodo) {
            if (updated.todos.length === 0) {
              log.error(
                `❌ Plan ${planId} has zero TODO items, blocking it.`,
                planId
              );
              ps.blocked = true;
              ps.lastError = "Plan has zero TODO items. Please add tasks.";
              continue;
            }

            log.success(`🎉 All TODOs complete for ${planId}`, planId);
            log.info(`   Setting plan status to: review`, planId);
            ps.status = "review";
            // Emit state update immediately so TUI shows review status
            if (options.useTUI) {
              dispatcherEvents.setState(state);
            }
            if (ps.pr) {
              log.info(`   Marking PR #${ps.pr} as ready for review`, planId);
              await markPRReady(repoRoot, ps.pr);
            }
            log.success(`✅ Plan ${planId} complete, PR marked ready`, planId);
          }
        } else {
          // All TODOs done
          if (plan.todos.length === 0) {
            log.error(
              `❌ Plan ${planId} has zero TODO items, blocking it.`,
              planId
            );
            ps.blocked = true;
            ps.lastError = "Plan has zero TODO items. Please add tasks.";
            continue;
          }

          log.success(`🎉 All TODOs complete for ${planId}`, planId);
          log.info(`   Setting plan status to: review`, planId);
          ps.status = "review";
          // Emit state update immediately so TUI shows review status
          if (options.useTUI) {
            dispatcherEvents.setState(state);
          }
          if (ps.pr) {
            log.info(`   Marking PR #${ps.pr} as ready for review`, planId);
            await markPRReady(repoRoot, ps.pr);
          }
          log.success(`✅ Plan ${planId} complete, PR marked ready`, planId);
        }
      }
    } catch (error) {
      log.error(`Error processing ${planId}: ${error}`, planId);
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
  ps: ActivatedPlanState,
  planId: string,
  plan: ReturnType<typeof parsePlan>,
  feedback: PRFeedback[],
  options: DispatcherOptions = {},
  log: Logger
): Promise<void> {
  // Store previous status to restore later
  const previousStatus = ps.status;
  
  // Set status to triaging
  ps.status = "triaging";
  
  // Ensure .prloom directory exists in worktree
  ensureWorktreePrloomDir(ps.worktree);

  const triageConfig = getAgentConfig(config, "triage");
  const adapter = getAdapter(triageConfig.agent);
  const prompt = renderTriagePrompt(repoRoot, ps.worktree, plan, feedback);

  log.info(
    `🔍 Running triage for ${planId}...`,
    planId
  );
  log.info(`   Using agent: ${triageConfig.agent}`, planId);

  // Build tmux config if available and not explicitly disabled
  const useTmux = options.tmux !== false && (await hasTmux());
  const tmuxConfig = useTmux
    ? { sessionName: `prloom-triage-${planId}` }
    : undefined;

  if (tmuxConfig) {
    log.info(
      `   Spawning in tmux session: ${tmuxConfig.sessionName}`,
      planId
    );
  }

  const execResult = await adapter.execute({
    cwd: ps.worktree,
    prompt,
    tmux: tmuxConfig,
    model: triageConfig.model,
  });

  // Wait for tmux session or detached process to complete
  if (execResult.tmuxSession) {
    await waitForExitCodeFile(execResult.tmuxSession);
  } else if (execResult.pid) {
    await waitForProcess(execResult.pid);
  }

  log.info(`   Triage agent completed`, planId);

  // Read and process triage result
  try {
    const result = readTriageResultFile(ps.worktree);

    // Handle rebase request
    if (result.rebase_requested) {
      log.info(
        `  Rebase requested, rebasing on ${ps.baseBranch}...`,
        planId
      );
      const rebaseResult = await rebaseOnBaseBranch(ps.worktree, ps.baseBranch);

      if (rebaseResult.hasConflicts) {
        log.warn(
          `   Rebase conflict detected, blocking plan`,
          planId
        );
        log.info(`   Blocking plan`, planId);
        ps.blocked = true;
        ps.lastError = `Rebase conflict: ${rebaseResult.conflictFiles?.join(
          ", "
        )}`;

        log.info(
          `   Posting rebase conflict comment to PR #${ps.pr}`,
          planId
        );
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
   prloom unpause ${planId}
   \`\`\`

The plan is now **blocked** until conflicts are resolved.`
        );
      } else if (rebaseResult.success) {
        log.info(
          `   Force pushing rebased branch: ${ps.branch}`,
          planId
        );
        await forcePush(ps.worktree, ps.branch);
        log.success(`   Rebased and force-pushed`, planId);
      }
    }

    // Post triage reply
    log.info(`   Posting triage reply to PR #${ps.pr}`, planId);
    await postPRComment(repoRoot, ps.pr!, result.reply_markdown);
    log.success(`   Posted triage reply`, planId);

    // Commit any changes from triage
    log.info(
      `   Committing: [prloom] ${planId}: triage`,
      planId
    );
    const committed = await commitAll(
      ps.worktree,
      `[prloom] ${planId}: triage`
    );
    if (committed) {
      log.info(`   Pushing to origin: ${ps.branch}`, planId);
      await push(ps.worktree, ps.branch);
    } else {
      log.info(`   No changes to commit from triage`, planId);
    }
    
    // Restore status to active after successful triage (unless blocked by rebase conflict)
    // The next dispatch loop will check for new TODOs and continue processing
    if (ps.status === "triaging") {
      log.info(`   Setting plan status back to: active`, planId);
      ps.status = "active";
    }
  } catch (error) {
    log.error(`   Triage failed: ${error}`, planId);
    log.info(`   Blocking plan`, planId);
    ps.blocked = true;
    ps.lastError = `Triage failed: ${error}`;

    log.info(
      `   Posting triage error comment to PR #${ps.pr}`,
      planId
    );
    await postPRComment(
      repoRoot,
      ps.pr!,
      `⚠️ Triage failed to produce a valid result file. Human attention needed.\n\nError: ${error}`
    );
  }
}

/**
 * Run the review agent to review the PR and post comments to GitHub.
 * The review agent examines the diff and posts a GitHub review with inline comments.
 * After posting, the triage flow will pick up the review comments as new feedback.
 */
async function runReviewAgent(
  repoRoot: string,
  config: Config,
  ps: ActivatedPlanState,
  planId: string,
  plan: ReturnType<typeof parsePlan>,
  options: DispatcherOptions = {},
  log: Logger
): Promise<void> {
  if (!ps.pr) {
    log.error(
      `   Cannot review: no PR associated with plan`,
      planId
    );
    return;
  }

  // Ensure .prloom directory exists in worktree
  ensureWorktreePrloomDir(ps.worktree);

  // Set status to reviewing
  ps.status = "reviewing";
  log.info(
    `🔍 Running review agent for ${planId}...`,
    planId
  );

  const reviewerConfig = getAgentConfig(config, "reviewer");
  const adapter = getAdapter(reviewerConfig.agent);
  const prompt = renderReviewPrompt(
    repoRoot,
    plan,
    ps.pr,
    ps.branch,
    ps.baseBranch
  );

  log.info(`   Using agent: ${reviewerConfig.agent}`, planId);

  // Build tmux config if available and not explicitly disabled
  const useTmux = options.tmux !== false && (await hasTmux());
  const tmuxConfig = useTmux
    ? { sessionName: `prloom-review-${planId}` }
    : undefined;

  if (tmuxConfig) {
    log.info(
      `   Spawning in tmux session: ${tmuxConfig.sessionName}`,
      planId
    );
  }

  try {
    const execResult = await adapter.execute({
      cwd: ps.worktree,
      prompt,
      tmux: tmuxConfig,
      model: reviewerConfig.model,
    });

    // Wait for tmux session or detached process to complete
    if (execResult.tmuxSession) {
      await waitForExitCodeFile(execResult.tmuxSession);
    } else if (execResult.pid) {
      await waitForProcess(execResult.pid);
    }

    log.info(`   Review agent completed`, planId);

    // Read and process review result
    const result = readReviewResultFile(ps.worktree);

    log.info(
      `   Verdict: ${result.verdict}, ${result.comments.length} inline comments`,
      planId
    );

    // Submit review to GitHub (all comments posted atomically)
    log.info(`   Submitting review to PR #${ps.pr}`, planId);
    await submitPRReview(repoRoot, ps.pr, {
      verdict: result.verdict,
      summary: result.summary,
      comments: result.comments,
    });
    log.success(`   Review submitted to GitHub`, planId);

    // Set status back to active - the triage flow will pick up the review
    // comments on the next poll cycle
    ps.status = "active";

    // Force an immediate poll to pick up our own review comments
    ps.pollOnce = true;
    log.info(
      `   Scheduled poll to process review feedback`,
      planId
    );
  } catch (error) {
    log.error(`   Review failed: ${error}`, planId);
    log.info(`   Blocking plan`, planId);
    ps.blocked = true;
    ps.lastError = `Review failed: ${error}`;

    log.info(
      `   Posting review error comment to PR #${ps.pr}`,
      planId
    );
    await postPRComment(
      repoRoot,
      ps.pr,
      `⚠️ Review agent failed to produce a valid result file. Human attention needed.\n\nError: ${error}`
    );
  }
}

function handleCommand(state: State, cmd: IpcCommand, log: Logger): void {
  const ps = state.plans[cmd.plan_id];
  if (!ps) return;

  if (cmd.type === "stop") {
    // Block the plan
    log.info(`⏹️ Stopping ${cmd.plan_id}`, cmd.plan_id);
    log.info(`   Blocking plan`, cmd.plan_id);
    ps.blocked = true;
    log.success(`   Plan blocked`, cmd.plan_id);
  } else if (cmd.type === "unpause") {
    // Unblock the plan
    log.info(`▶️ Unpausing ${cmd.plan_id}`, cmd.plan_id);
    log.info(`   Unblocking plan`, cmd.plan_id);
    ps.blocked = false;
    // Reset retry counter when unblocking
    ps.lastTodoIndex = undefined;
    ps.todoRetryCount = undefined;
    log.success(`   Plan unblocked, retry counter reset`, cmd.plan_id);
  } else if (cmd.type === "poll") {
    // Force a single immediate feedback poll without shifting schedule
    ps.pollOnce = true;
  } else if (cmd.type === "launch_poll") {
    // Force immediate feedback poll AND reset schedule (poll timestamp)
    ps.lastPolledAt = undefined;
    log.info(
      `🔄 Launching immediate poll (reset schedule) for ${cmd.plan_id}`,
      cmd.plan_id
    );
  } else if (cmd.type === "review") {
    // Trigger a review agent run (only valid when status is "review")
    if (ps.status !== "review") {
      log.warn(
        `⚠️ Cannot review ${cmd.plan_id}: status is "${ps.status}", expected "review"`,
        cmd.plan_id
      );
      return;
    }
    ps.pendingReview = true;
    log.info(`🔍 Review scheduled for ${cmd.plan_id}`, cmd.plan_id);
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
  const controlPath = getControlPath(repoRoot);
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
