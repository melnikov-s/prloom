import { glob } from "glob";
import { join } from "path";
import { loadConfig, resolveWorktreesDir } from "./config.js";
import {
  loadState,
  saveState,
  saveShard,
  acquireLock,
  releaseLock,
  type State,
  type PlanState,
} from "./state.js";
import { consume, type IpcCommand } from "./ipc.js";
import {
  parsePlan,
  findNextUnchecked,
  setStatus,
  setBranch,
  setPR,
  extractBody,
  type Plan,
} from "./plan.js";
import {
  branchExists,
  createBranchName,
  createWorktree,
  commitAll,
  push,
  hasCommits,
} from "./git.js";
import { createDraftPR, updatePRBody, markPRReady } from "./github.js";
import { runWorker, abortSession, shutdownAll } from "./opencode.js";
import { renderWorkerPrompt } from "./template.js";

export async function runDispatcher(repoRoot: string): Promise<void> {
  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);

  acquireLock(repoRoot);

  const cleanup = () => {
    shutdownAll();
    releaseLock(repoRoot);
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  let state = loadState(repoRoot);

  console.log("Dispatcher started. Press Ctrl+C to stop.");

  while (true) {
    try {
      // 1. Consume IPC commands
      const { commands, newCursor } = consume(repoRoot, state.control_cursor);
      state.control_cursor = newCursor;

      for (const cmd of commands) {
        await handleCommand(repoRoot, state, cmd);
      }

      // 2. Process plans
      const planFiles = await glob("plans/*.md", { cwd: repoRoot });

      for (const planFile of planFiles) {
        const planPath = join(repoRoot, planFile);
        const plan = parsePlan(planPath);

        let ps = state.plans[plan.frontmatter.id];

        if (!ps) {
          ps = initPlanState(plan, worktreesDir);
          state.plans[plan.frontmatter.id] = ps;
        }

        // Skip if paused, blocked, or done
        if (
          ps.paused ||
          plan.frontmatter.status === "blocked" ||
          plan.frontmatter.status === "done"
        ) {
          continue;
        }

        // Ensure infrastructure
        if (!ps.branch) {
          const branch = await createBranchName(plan.frontmatter.id);
          ps.branch = branch;
          ps.worktree = join(worktreesDir, branch);

          await createWorktree(repoRoot, worktreesDir, branch);
          setBranch(planPath, branch);
          setStatus(planPath, "active");
        }

        // Create draft PR after first commit
        if (!ps.pr && (await hasCommits(repoRoot, ps.branch))) {
          const body = extractBody(plan);
          ps.pr = await createDraftPR(
            repoRoot,
            ps.branch,
            plan.frontmatter.id,
            body
          );
          setPR(planPath, ps.pr);
        }

        // Find next TODO
        const todo = findNextUnchecked(plan);

        if (!todo) {
          // All done
          setStatus(planPath, "done");
          await commitAll(ps.worktree, `[swarm] ${plan.frontmatter.id}: done`);
          await push(ps.worktree, ps.branch);
          if (ps.pr) {
            await markPRReady(repoRoot, ps.pr);
          }
          console.log(`✅ Plan ${plan.frontmatter.id} complete`);
          continue;
        }

        // Run worker for this TODO
        ps.next_todo = todo.index;
        saveState(repoRoot, state);
        saveShard(repoRoot, plan.frontmatter.id, ps);

        console.log(
          `🔧 Running TODO #${todo.index} for ${plan.frontmatter.id}: ${todo.text}`
        );

        const prompt = renderWorkerPrompt(repoRoot, plan, todo);
        ps.session_id = await runWorker(
          ps.worktree,
          plan.frontmatter.id,
          prompt
        );

        // Commit and push
        const committed = await commitAll(
          ps.worktree,
          `[swarm] ${plan.frontmatter.id}: TODO #${todo.index}`
        );
        if (committed) {
          await push(ps.worktree, ps.branch);
        }

        // Re-parse and check status
        const updated = parsePlan(planPath);
        if (ps.pr) {
          await updatePRBody(repoRoot, ps.pr, extractBody(updated));
        }

        if (updated.frontmatter.status === "blocked") {
          console.log(`⚠️ Plan ${plan.frontmatter.id} is blocked`);
        }
      }

      saveState(repoRoot, state);
      await sleep(config.poll_interval_ms);
    } catch (error) {
      console.error("Dispatcher error:", error);
      await sleep(config.poll_interval_ms);
    }
  }
}

async function handleCommand(
  repoRoot: string,
  state: State,
  cmd: IpcCommand
): Promise<void> {
  const ps = state.plans[cmd.plan_id];
  if (!ps) return;

  if (cmd.type === "stop") {
    ps.paused = true;
    if (ps.session_id) {
      await abortSession(cmd.plan_id);
    }
    console.log(`⏸️ Paused ${cmd.plan_id}`);
  } else if (cmd.type === "unpause") {
    ps.paused = false;
    console.log(`▶️ Unpaused ${cmd.plan_id}`);
  }

  saveState(repoRoot, state);
}

function initPlanState(plan: Plan, worktreesDir: string): PlanState {
  return {
    worktree: "",
    branch: "",
    paused: false,
    next_todo: 0,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
