import { join } from "path";
import { existsSync, statSync, readFileSync } from "fs";
import {
  loadConfig,
  resolveWorktreesDir,
  getAgentConfig,
  resolveConfig,
  loadWorktreeConfig,
  writeWorktreeConfig,
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
  getMaxFeedbackIds,
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
} from "./template.js";
import { dispatcherEvents } from "./events.js";
import {
  initBusRunner,
  tickBusEvents,
  tickBusActions,
  readBusEventsForTriage,
  feedbackToEvents,
  appendBusAction,
  createCommentAction,
} from "./bus/index.js";
import {
  loadPlugins,
  runHooks,
  buildHookContext,
  buildBeforeTriageContext,
  type HookRegistry,
  type BeforeTriageContext,
} from "./hooks/index.js";
import { writeFileSync } from "fs";
import {
  logDispatcherError,
  logAdapterError,
  logFatalError,
  logWarning,
  flushErrorBuffer,
} from "./errors.js";

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
  status: "active" | "review" | "triaging" | "done";
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

  // Initialize bus runner (loads bridges including custom modules)
  await initBusRunner(repoRoot, config);
  log.info("Bus initialized with bridges");


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
      await processActivePlans(
        repoRoot,
        config,
        state,
        botLogin,
        options,
        log
      );

      saveState(repoRoot, state);

      // Emit updated state for TUI
      if (options.useTUI) {
        dispatcherEvents.setState(state);
      }

      // Main loop: tick interval is configurable (default: 1000ms per RFC)
      await sleepUntilIpcOrTimeout(
        repoRoot,
        state.control_cursor,
        config.bus.tickIntervalMs
      );
    } catch (error) {
      log.error(`Dispatcher error: ${error}`);
      logDispatcherError(undefined, `Main loop error: ${error}`, error);

      await sleepUntilIpcOrTimeout(
        repoRoot,
        state.control_cursor,
        config.bus.tickIntervalMs
      );
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

      // Resolve per-plan config (global + preset, worktree config applied later)
      const planConfig = resolveConfig(config, planMeta.preset);
      const githubEnabled = planConfig.github.enabled;

      log.info(`📥 Ingesting inbox plan: ${actualId} (from ${planId}.md)`);
      if (planMeta.preset) {
        log.info(`   Preset: ${planMeta.preset}`);
      }
      if (!githubEnabled) {
        log.info(`   GitHub integration: disabled (local-only mode)`);
      }

      // Determine base branch for this plan (from state, falls back to config)
      const baseBranch = planMeta.baseBranch ?? planConfig.base_branch;
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

      // Write worktree config if preset was selected
      if (planMeta.preset && config.presets?.[planMeta.preset]) {
        const presetConfig = config.presets[planMeta.preset];
        if (presetConfig) {
          writeWorktreeConfig(worktreePath, presetConfig);
          log.info(`   Wrote worktree config for preset: ${planMeta.preset}`);
        }
      }

      // Plan stays in .local/ - not committed to repo
      // Copy to worktree's local dir for worker access
      const planRelpath = `prloom/.local/plan.md`;
      log.info(`   Copying plan to worktree local: ${planRelpath}`);
      copyFileToWorktree(inboxPath, worktreePath, planRelpath);

      // Create empty initial commit
      const worktreePlanPath = join(worktreePath, planRelpath);
      const planForPR = parsePlan(worktreePlanPath);
      const prTitle = planForPR.title || actualId;
      log.info(`   Creating initial commit: ${prTitle}`);
      await commitEmpty(
        worktreePath,
        `${prTitle}\n\n${extractBody(planForPR)}`
      );

      let pr: number | undefined;

      // Only push and create PR if GitHub is enabled
      if (githubEnabled) {
        log.info(`   Pushing branch to origin: ${branch}`);
        await push(worktreePath, branch);

        // Create draft PR
        log.info(`   Creating draft PR...`);
        pr = await createDraftPR(
          repoRoot,
          branch,
          baseBranch,
          prTitle,
          extractBody(planForPR)
        );
        log.info(`   Created draft PR #${pr}`);
      }

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

      if (githubEnabled) {
        log.success(`✅ Ingested ${actualId} → PR #${pr}`);
      } else {
        log.success(`✅ Ingested ${actualId} (local-only, no PR)`);
      }
    } catch (error) {
      log.error(
        `❌ Failed to ingest plan ${planId}: ${
          error instanceof Error ? error.message : error
        }`
      );
      logDispatcherError(
        undefined,
        `Failed to ingest plan ${planId}`,
        error,
        planId,
        { inboxPath }
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

/**
 * Helper to run hooks at a lifecycle point and update the plan file if modified.
 *
 * @returns The updated plan (re-parsed if modified)
 */
async function runPlanHooks(
  hookPoint: "afterDesign" | "beforeTodo" | "afterTodo" | "beforeFinish" | "afterFinish",
  plan: ReturnType<typeof parsePlan>,
  planPath: string,
  repoRoot: string,
  worktree: string,
  planId: string,
  prNumber: number | undefined,
  planConfig: Config,
  hookRegistry: HookRegistry,
  log: Logger,
  todoCompleted?: string
): Promise<ReturnType<typeof parsePlan>> {
  // Skip if no hooks registered for this point
  if (!hookRegistry[hookPoint] || hookRegistry[hookPoint]!.length === 0) {
    return plan;
  }

  const ctx = buildHookContext({
    repoRoot,
    worktree,
    planId,
    hookPoint,
    changeRequestRef: prNumber?.toString(),
    todoCompleted,
    currentPlan: plan.raw,
    config: planConfig,
  });

  try {
    const originalContent = plan.raw;
    const updatedContent = await runHooks(
      hookPoint,
      originalContent,
      ctx,
      hookRegistry
    );

    // If plan was modified by hooks, write and re-parse
    if (updatedContent !== originalContent) {
      writeFileSync(planPath, updatedContent);
      log.info(`   Hooks modified plan at ${hookPoint}`, planId);
      return parsePlan(planPath);
    }
  } catch (error) {
    log.error(`   Hook error at ${hookPoint}: ${error}`, planId);
    throw error;
  }

  return plan;
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

      // Resolve per-plan config (global + preset + worktree overrides)
      const worktreeConfig = loadWorktreeConfig(ps.worktree);
      const planConfig = resolveConfig(config, ps.preset, worktreeConfig);
      const githubEnabled = planConfig.github.enabled;

      let hookRegistry: HookRegistry = {};
      if (planConfig.plugins) {
        try {
          hookRegistry = await loadPlugins(planConfig, repoRoot);
        } catch (error) {
          log.error(`Failed to load plugins: ${error}`, planId);
          hookRegistry = {};
        }
      }

      const planPath = join(ps.worktree, ps.planRelpath);

      if (!existsSync(planPath)) {
        log.warn(`Plan file not found: ${planPath}`, planId);
        continue;
      }

      // Check PR state - remove if merged/closed (only if GitHub is enabled)
      if (githubEnabled && ps.pr) {
        const prState = await getPRState(repoRoot, ps.pr);
        if (prState === "merged" || prState === "closed") {
          log.info(
            `PR #${ps.pr} ${prState}, removing from active`,
            planId
          );
          delete state.plans[planId];
          continue;
        }
      }

      // Skip if plan is blocked or triaging
      let plan = parsePlan(planPath);
      if (ps.blocked || ps.status === "triaging") {
        continue;
      }

      // =================================================================
      // Bus Tick: Poll all bridges for events and route pending actions
      // Bridges handle their own timing internally (self-throttle)
      // =================================================================
      if (ps.worktree) {
        // Handle one-off poll request (e.g., `prloom poll <id>`)
        // This forces an immediate poll by clearing bridge state timestamps
        if (ps.pollOnce) {
          ps.pollOnce = undefined;
          // TODO: Could signal bridges to skip their timing check
        }

        // Tick all bridges - they self-throttle based on their config
        // This polls bridges and appends events to events.jsonl
        await tickBusEvents(repoRoot, ps.worktree, ps, planConfig, log);

        // Route any pending actions to bridges
        await tickBusActions(repoRoot, ps.worktree, ps, planConfig, log);

        // Read events from the bus with deduplication (RFC: append → read → dedupe → triage)
        // This reads from events.jsonl, deduplicates by Event.id, and updates offsets
        const newEvents = readBusEventsForTriage(ps.worktree);

        // Process any new events
        if (newEvents.length > 0) {
          log.info(`💬 ${newEvents.length} new events`, planId);

          // =============================================================
          // Run beforeTriage hooks for event interception
          // See RFC: docs/rfc-plugin-bridge-primitives.md
          // =============================================================
          let eventsForTriage = newEvents;

          if (hookRegistry.beforeTriage && hookRegistry.beforeTriage.length > 0) {
            // Run beforeTriage hooks for each plugin
            for (const pluginName of Object.keys(planConfig.plugins ?? {})) {
              const pluginHooks = hookRegistry.beforeTriage;
              if (!pluginHooks || pluginHooks.length === 0) continue;

              const beforeTriageCtx = buildBeforeTriageContext({
                repoRoot,
                worktree: ps.worktree,
                planId,
                events: eventsForTriage,
                changeRequestRef: ps.pr?.toString(),
                pluginName,
                config: planConfig,
              });

              // Run all beforeTriage hooks
              try {
                await runHooks("beforeTriage", plan.raw, beforeTriageCtx, hookRegistry);

                // Save interception state (handled/deferred events)
                beforeTriageCtx.saveInterceptionState?.();

                // Get events that should continue to triage
                eventsForTriage = beforeTriageCtx.getEventsForTriage?.() ?? eventsForTriage;
              } catch (error) {
                log.error(
                  `beforeTriage hook error: ${error}`,
                  planId
                );
                // Continue with remaining events on hook error
              }
            }

            if (eventsForTriage.length < newEvents.length) {
              const handled = newEvents.length - eventsForTriage.length;
              log.info(`🎯 ${handled} events handled/deferred by plugins`, planId);
            }
          }

          // Convert GitHub events to PRFeedback for triage compatibility
          const newFeedback: PRFeedback[] = eventsForTriage
            .filter((e) => e.source === "github")
            .map((e) => ({
              id: (e.context?.feedbackId as number) ?? 0,
              type:
                (e.context?.feedbackType as PRFeedback["type"]) ??
                "issue_comment",
              author: (e.context?.author as string) ?? "",
              body: e.body,
              path: e.context?.path as string | undefined,
              line: e.context?.line as number | undefined,
              diffHunk: e.context?.diffHunk as string | undefined,
              reviewState: e.context?.reviewState as string | undefined,
              createdAt:
                (e.context?.createdAt as string) ?? new Date().toISOString(),
              inReplyToId: e.context?.inReplyToId as number | undefined,
            }));

          // Run triage for GitHub feedback
          if (newFeedback.length > 0 && ps.pr) {
            await runTriage(
              repoRoot,
              planConfig,
              ps as ActivatedPlanState,
              planId,
              plan,
              newFeedback,
              options,
              log
            );

            // Re-parse plan after triage may have modified it
            plan = parsePlan(planPath);

            // Update cursors from processed feedback
            const maxIds = getMaxFeedbackIds(newFeedback);
            if (maxIds.lastIssueCommentId)
              ps.lastIssueCommentId = maxIds.lastIssueCommentId;
            if (maxIds.lastReviewId) ps.lastReviewId = maxIds.lastReviewId;
            if (maxIds.lastReviewCommentId)
              ps.lastReviewCommentId = maxIds.lastReviewCommentId;
          }

          // TODO: Handle non-GitHub events (e.g., Buildkite) here
        }
      }

      // Execute next TODO (only if status is active)
      const nextTodo = findNextUnchecked(plan);

      // If we find unchecked TODOs but status is review/done, flip back to active
      if (nextTodo && (ps.status === "review" || ps.status === "done")) {
        log.info(
          `🔄 New TODOs found, flipping ${planId} back to active`,
          planId
        );
        ps.status = "active";
      }

      if (ps.status === "active") {
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
            `🔧 Running TODO #${todo.index + 1}: ${todo.text}`,
            planId
          );

          // Run beforeTodo hooks
          plan = await runPlanHooks(
            "beforeTodo",
            plan,
            planPath,
            repoRoot,
            ps.worktree,
            planId,
            ps.pr,
            planConfig,
            hookRegistry,
            log
          );

          const prompt = renderWorkerPrompt(repoRoot, ps.planRelpath, plan, todo);
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
          } else if (execResult.exitCode !== undefined && execResult.exitCode !== 0) {
            // Adapter failed to spawn - log and continue to retry logic
            log.warn(
              `   ⚠️ Adapter failed to spawn worker (exitCode: ${execResult.exitCode})`,
              planId
            );
            logAdapterError(
              ps.worktree,
              `Adapter failed to spawn worker for TODO #${todo.index + 1}`,
              undefined,
              planId,
              { exitCode: execResult.exitCode, agent: workerConfig.agent, todoText: todo.text }
            );
            continue;
          } else if (!execResult.tmuxSession && !execResult.pid) {
            // No session, no pid, no error - something went wrong silently
            log.warn(
              `   ⚠️ Adapter returned no session/pid and no error`,
              planId
            );
            logAdapterError(
              ps.worktree,
              `Adapter returned no session/pid for TODO #${todo.index + 1}`,
              undefined,
              planId,
              { execResult, agent: workerConfig.agent, todoText: todo.text }
            );
            continue;
          }

          // Poll for completion
          if (execResult.tmuxSession) {
            const waitResult = await waitForExitCodeFile(execResult.tmuxSession);
            
            if (waitResult.timedOut) {
              log.error(
                `   ❌ Worker timed out for TODO #${todo.index + 1}`,
                planId
              );
              logFatalError(
                ps.worktree,
                "adapter",
                `Worker timed out waiting for exit code file`,
                undefined,
                planId,
                { tmuxSession: execResult.tmuxSession, todoText: todo.text }
              );
              continue;
            }
            
            if (waitResult.sessionDied && !waitResult.found) {
              log.error(
                `   ❌ Tmux session died without creating exit code file for TODO #${todo.index + 1}`,
                planId
              );
              logFatalError(
                ps.worktree,
                "adapter",
                `Tmux session died without creating exit code file`,
                undefined,
                planId,
                { tmuxSession: execResult.tmuxSession, todoText: todo.text }
              );
              continue;
            }
            
            const tmuxResult = readExecutionResult(execResult.tmuxSession);
            if (tmuxResult.exitCode !== 0) {
              log.warn(
                `   ⚠️ Worker exited with code ${tmuxResult.exitCode}`,
                planId
              );
              logAdapterError(
                ps.worktree,
                `Worker exited with non-zero code for TODO #${todo.index + 1}`,
                undefined,
                planId,
                { exitCode: tmuxResult.exitCode, tmuxSession: execResult.tmuxSession }
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
            logAdapterError(
              ps.worktree,
              `Worker exited with code ${execResult.exitCode} for TODO #${todo.index + 1}`,
              undefined,
              planId,
              { exitCode: execResult.exitCode }
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

            // Log the error for diagnosis
            logWarning(
              ps.worktree,
              "adapter",
              `TODO #${todo.index + 1} not marked complete by worker`,
              planId,
              { 
                exitCode: execResult.exitCode, 
                todoText: todo.text,
                logPath,
                retryCount: ps.todoRetryCount ?? 0
              }
            );

            // Don't commit/push, let retry logic handle it on next iteration
            continue;
          }

          // TODO was completed - reset retry tracking
          ps.lastTodoIndex = undefined;
          ps.todoRetryCount = undefined;
          log.success(`   ✓ TODO #${todo.index + 1} marked complete`, planId);

          // Run afterTodo hooks
          const todoText = todo.text;
          let afterTodoPlan = parsePlan(planPath);
          afterTodoPlan = await runPlanHooks(
            "afterTodo",
            afterTodoPlan,
            planPath,
            repoRoot,
            ps.worktree,
            planId,
            ps.pr,
            planConfig,
            hookRegistry,
            log,
            todoText
          );

          // Commit and push (push only if GitHub is enabled)
          log.info(`   Committing: ${todo.text}`, planId);
          const committed = await commitAll(ps.worktree, todo.text);
          if (committed && ps.branch && githubEnabled) {
            log.info(`   Pushing to origin: ${ps.branch}`, planId);
            await push(ps.worktree, ps.branch);
          } else if (committed && !githubEnabled) {
            log.info(`   Committed locally (GitHub disabled)`, planId);
          } else if (committed) {
            log.warn(`   No branch set, skipping push`, planId);
          } else {
            log.info(`   No changes to commit`, planId);
          }

          // Re-parse and check status
          const updated = parsePlan(planPath);
          if (githubEnabled && ps.pr) {
            log.info(`   Updating PR #${ps.pr} body`, planId);
            await updatePRBody(repoRoot, ps.pr, extractBody(updated));
          }

          // Check if all TODOs are now complete
          const remainingTodo = findNextUnchecked(updated);
          if (!remainingTodo) {
            if (updated.todos.length === 0) {
              log.error(
                `❌ Plan has zero TODO items, blocking it.`,
                planId
              );
              ps.blocked = true;
              ps.lastError = "Plan has zero TODO items. Please add tasks.";
              continue;
            }

            log.success(`🎉 All TODOs complete`, planId);

            // Run beforeFinish hooks
            let finishPlan = parsePlan(planPath);
            finishPlan = await runPlanHooks(
              "beforeFinish",
              finishPlan,
              planPath,
              repoRoot,
              ps.worktree,
              planId,
              ps.pr,
              planConfig,
              hookRegistry,
              log
            );

            // Re-check if hooks added new TODOs
            const newTodos = findNextUnchecked(finishPlan);
            if (newTodos) {
              log.info(`   Hooks added new TODOs, continuing work`, planId);
              continue;
            }

            log.info(`   Setting plan status to: review`, planId);
            ps.status = "review";
            // Emit state update immediately so TUI shows review status
            if (options.useTUI) {
              dispatcherEvents.setState(state);
            }
            if (githubEnabled && ps.pr) {
              log.info(`   Marking PR #${ps.pr} as ready for review`, planId);
              await markPRReady(repoRoot, ps.pr);
              log.success(
                `✅ Plan complete, PR marked ready`,
                planId
              );
            } else {
              log.success(`✅ Plan complete`, planId);
            }

            // Run afterFinish hooks
            await runPlanHooks(
              "afterFinish",
              parsePlan(planPath),
              planPath,
              repoRoot,
              ps.worktree,
              planId,
              ps.pr,
              planConfig,
              hookRegistry,
              log
            );
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

          log.success(`🎉 All TODOs complete`, planId);

          // Run beforeFinish hooks
          let finishPlan2 = parsePlan(planPath);
          finishPlan2 = await runPlanHooks(
            "beforeFinish",
            finishPlan2,
            planPath,
            repoRoot,
            ps.worktree,
            planId,
            ps.pr,
            planConfig,
            hookRegistry,
            log
          );

          // Re-check if hooks added new TODOs
          const newTodos2 = findNextUnchecked(finishPlan2);
          if (newTodos2) {
            log.info(`   Hooks added new TODOs, continuing work`, planId);
            continue;
          }

          log.info(`   Setting plan status to: review`, planId);
          ps.status = "review";
          // Emit state update immediately so TUI shows review status
          if (options.useTUI) {
            dispatcherEvents.setState(state);
          }
          if (githubEnabled && ps.pr) {
            log.info(`   Marking PR #${ps.pr} as ready for review`, planId);
            await markPRReady(repoRoot, ps.pr);
            log.success(`✅ Plan complete, PR marked ready`, planId);
          } else {
            log.success(`✅ Plan complete`, planId);
          }

          // Run afterFinish hooks
          await runPlanHooks(
            "afterFinish",
            parsePlan(planPath),
            planPath,
            repoRoot,
            ps.worktree,
            planId,
            ps.pr,
            planConfig,
            hookRegistry,
            log
          );
        }
      }
    } catch (error) {
      log.error(`Error processing plan: ${error}`, planId);
      ps.lastError = String(error);
      // Per RFC: "If a hook throws, abort." Block the plan to prevent retry loops.
      ps.blocked = true;
      logFatalError(
        ps.worktree,
        "dispatcher",
        `Error processing plan, blocking: ${error}`,
        error,
        planId,
        { status: ps.status }
      );
    }
  }
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
  const prompt = renderTriagePrompt(repoRoot, ps.worktree, ps.planRelpath, plan, feedback);

  log.info(`🔍 Running triage...`, planId);
  log.info(`   Using agent: ${triageConfig.agent}`, planId);

  // Build tmux config if available and not explicitly disabled
  const useTmux = options.tmux !== false && (await hasTmux());
  const tmuxConfig = useTmux
    ? { sessionName: `prloom-triage-${planId}` }
    : undefined;

  if (tmuxConfig) {
    log.info(`   Spawning in tmux session: ${tmuxConfig.sessionName}`, planId);
  }

  const execResult = await adapter.execute({
    cwd: ps.worktree,
    prompt,
    tmux: tmuxConfig,
    model: triageConfig.model,
  });

  // Wait for tmux session or detached process to complete
  if (execResult.tmuxSession) {
    const waitResult = await waitForExitCodeFile(execResult.tmuxSession);
    if (waitResult.timedOut || (waitResult.sessionDied && !waitResult.found)) {
      log.error(`   ❌ Triage session failed (timeout or session died)`, planId);
      logFatalError(
        ps.worktree,
        "triage",
        `Triage session failed: ${waitResult.timedOut ? 'timeout' : 'session died'}`,
        undefined,
        planId,
        { tmuxSession: execResult.tmuxSession }
      );
      ps.blocked = true;
      ps.lastError = `Triage failed: ${waitResult.timedOut ? 'timeout' : 'session died without exit code'}`;
      return;
    }
  } else if (execResult.pid) {
    await waitForProcess(execResult.pid);
  }

  log.info(`   Triage agent completed`, planId);

  // Read and process triage result
  try {
    const result = readTriageResultFile(ps.worktree);

    // Handle rebase request
    if (result.rebase_requested) {
      log.info(`  Rebase requested, rebasing on ${ps.baseBranch}...`, planId);
      const rebaseResult = await rebaseOnBaseBranch(ps.worktree, ps.baseBranch);

      if (rebaseResult.hasConflicts) {
        log.warn(`   Rebase conflict detected, blocking plan`, planId);
        log.info(`   Blocking plan`, planId);
        ps.blocked = true;
        ps.lastError = `Rebase conflict: ${rebaseResult.conflictFiles?.join(
          ", "
        )}`;

        log.info(`   Posting rebase conflict comment to PR #${ps.pr}`, planId);
        const rebaseMessage = `⚠️ **Rebase conflict detected**

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

The plan is now **blocked** until conflicts are resolved.`;
        // Post via bus action
        appendBusAction(
          ps.worktree,
          createCommentAction(ps.pr!, rebaseMessage)
        );
      } else if (rebaseResult.success) {
        log.info(`   Force pushing rebased branch: ${ps.branch}`, planId);
        await forcePush(ps.worktree, ps.branch);
        log.success(`   Rebased and force-pushed`, planId);
      }
    }

    // Post triage reply via bus
    log.info(`   Posting triage reply to PR #${ps.pr}`, planId);
    if (ps.worktree && ps.pr) {
      appendBusAction(
        ps.worktree,
        createCommentAction(ps.pr, result.reply_markdown)
      );
    }
    log.success(`   Queued triage reply for delivery`, planId);

    // Commit any changes from triage
    log.info(`   Committing: [prloom] triage`, planId);
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

    log.info(`   Posting triage error comment to PR #${ps.pr}`, planId);
    // Post via bus action
    if (ps.worktree && ps.pr) {
      appendBusAction(
        ps.worktree,
        createCommentAction(
          ps.pr,
          `⚠️ Triage failed to produce a valid result file. Human attention needed.\n\nError: ${error}`
        )
      );
    }
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
