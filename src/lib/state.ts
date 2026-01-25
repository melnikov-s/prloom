import { join } from "path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
} from "fs";

// =============================================================================
// PlanSource - External Identity Tracking
// =============================================================================

/**
 * Tracks the external origin of a plan.
 * Used for syncing with external systems like GitHub, Jira, Linear.
 */
export interface PlanSource {
  /** External system identifier (e.g., "github", "jira", "linear") */
  system: string;
  /** Type of entity (e.g., "issue", "ticket", "card") */
  kind: string;
  /** External ID (e.g., "123", "PROJ-456") */
  id: string;
}

export interface PlanState {
  /** Preset name used when plan was created */
  preset?: string;

  /** Base branch to create the worktree from (captured at plan creation) */
  baseBranch?: string;

  /** Full path to worktree (only set after activation) */
  worktree?: string;

  /** Git branch name */
  branch?: string;

  /** GitHub PR number */
  pr?: number;

  /** Relative path to plan file in worktree */
  planRelpath?: string;

  /** Plan execution status */
  status:
    | "draft"
    | "queued"
    | "active"
    | "paused"
    | "review"
    | "triaging"
    | "done";

  /** Whether the plan is blocked */
  blocked?: boolean;

  /** Active tmux session name */
  tmuxSession?: string;

  /** Active agent process PID */
  pid?: number;

  /** Force a one-time PR feedback poll */
  pollOnce?: boolean;

  // Cursors for incremental PR feedback polling
  lastIssueCommentId?: number;
  lastReviewId?: number;
  lastReviewCommentId?: number;
  lastPolledAt?: string;
  lastError?: string;

  // Retry tracking
  lastTodoIndex?: number;
  todoRetryCount?: number;

  // ==========================================================================
  // RFC: Commit Review Gate
  // ==========================================================================

  /** LLM session ID for worker (for session reuse across review loops) */
  workerSessionId?: string;
  /** Path to worker's log file (for session ID extraction) */
  workerLogFile?: string;
  /** LLM session ID for commit reviewer (for session reuse across loops) */
  commitReviewSessionId?: string;
  /** Path to reviewer's log file (for session ID extraction) */
  commitReviewLogFile?: string;
  /** Number of commit review → fix cycles for current TODO */
  commitReviewLoopCount?: number;

  // ==========================================================================
  // RFC: Global Bridges & Core Bridge extensions
  // ==========================================================================

  /**
   * If true, dispatcher ignores this plan during activation.
   * Plan is tracked but not executed until explicitly un-hidden.
   */
  hidden?: boolean;

  /**
   * External system identity for this plan.
   * Used by prloom-core for upsert_plan resolution.
   */
  source?: PlanSource;
}

export interface State {
  control_cursor: number;
  plans: Record<string, PlanState>;
}

const PRLOOM_DIR = "prloom/.local";
const WORKTREES_DIR = "prloom/.local/worktrees";
const INBOX_DIR = "inbox";
const STATE_FILE = "state.json";
const LOCK_FILE = "lock";

function getPrloomDir(repoRoot: string): string {
  return join(repoRoot, PRLOOM_DIR);
}

function ensurePrloomDir(repoRoot: string): void {
  const dir = getPrloomDir(repoRoot);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// Lock

interface LockData {
  pid: number;
  started_at: string;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireLock(repoRoot: string): void {
  ensurePrloomDir(repoRoot);
  const lockPath = join(getPrloomDir(repoRoot), LOCK_FILE);

  if (existsSync(lockPath)) {
    const raw = readFileSync(lockPath, "utf-8");
    const lock: LockData = JSON.parse(raw);
    if (isProcessAlive(lock.pid)) {
      throw new Error(`Dispatcher already running (PID ${lock.pid})`);
    }
  }

  const lock: LockData = {
    pid: process.pid,
    started_at: new Date().toISOString(),
  };
  writeFileSync(lockPath, JSON.stringify(lock, null, 2));
}

export function releaseLock(repoRoot: string): void {
  const lockPath = join(getPrloomDir(repoRoot), LOCK_FILE);
  if (existsSync(lockPath)) {
    unlinkSync(lockPath);
  }
}

// State - stored per-worktree, scanned on load

/**
 * Load state by scanning worktrees and inbox.
 * Each worktree has its own state.json, inbox plans have metadata in .json files.
 */
export function loadState(repoRoot: string): State {
  const plans: Record<string, PlanState> = {};
  const worktreesDir = join(repoRoot, WORKTREES_DIR);

  // Scan worktrees
  if (existsSync(worktreesDir)) {
    for (const name of readdirSync(worktreesDir)) {
      const worktreePath = join(worktreesDir, name);
      const statePath = join(worktreePath, PRLOOM_DIR, STATE_FILE);

      if (!existsSync(statePath)) continue;

      try {
        const raw = readFileSync(statePath, "utf-8");
        const state = JSON.parse(raw);
        if (state.id) {
          plans[state.id] = { ...state, worktree: worktreePath };
        }
      } catch {
        // Skip corrupt state files
      }
    }
  }

  // Scan inbox
  const inboxDir = join(getPrloomDir(repoRoot), INBOX_DIR);
  if (existsSync(inboxDir)) {
    for (const file of readdirSync(inboxDir)) {
      if (!file.endsWith(".md")) continue;

      const id = file.replace(/\.md$/, "");
      if (plans[id]) continue; // Already activated

      // Load metadata from .json file if exists
      const metaPath = join(inboxDir, `${id}.json`);
      if (existsSync(metaPath)) {
        try {
          const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
          plans[id] = { status: "draft", ...meta };
        } catch {
          plans[id] = { status: "draft" };
        }
      } else {
        plans[id] = { status: "draft" };
      }
    }
  }

  return { control_cursor: 0, plans };
}

/**
 * Save state to per-worktree files and inbox metadata.
 */
export function saveState(repoRoot: string, state: State): void {
  for (const [id, ps] of Object.entries(state.plans)) {
    if (ps.worktree) {
      // Active plan - save to worktree state.json
      const stateDir = join(ps.worktree, PRLOOM_DIR);
      if (!existsSync(stateDir)) {
        mkdirSync(stateDir, { recursive: true });
      }

      const statePath = join(stateDir, STATE_FILE);
      const { worktree, ...rest } = ps;
      writeFileSync(statePath, JSON.stringify({ id, ...rest }, null, 2));
    } else if (ps.status === "draft" || ps.status === "queued") {
      // Inbox plan - save metadata to .json file
      ensureInboxDir(repoRoot);
      const metaPath = join(getPrloomDir(repoRoot), INBOX_DIR, `${id}.json`);
      writeFileSync(metaPath, JSON.stringify(ps, null, 2));
    }
  }
}

// Inbox

export function ensureInboxDir(repoRoot: string): void {
  const inboxDir = join(getPrloomDir(repoRoot), INBOX_DIR);
  if (!existsSync(inboxDir)) {
    mkdirSync(inboxDir, { recursive: true });
  }
}

export function getInboxPath(repoRoot: string, planId: string): string {
  const inboxDir = join(getPrloomDir(repoRoot), INBOX_DIR);
  const exactPath = join(inboxDir, `${planId}.md`);

  if (existsSync(exactPath)) {
    return exactPath;
  }

  // Fallback: search for files ending in -<planId>.md
  if (existsSync(inboxDir)) {
    const files = readdirSync(inboxDir);
    const match = files.find((f) => f.endsWith(`-${planId}.md`));
    if (match) {
      return join(inboxDir, match);
    }
  }

  return exactPath;
}

export function listInboxPlanIds(repoRoot: string): string[] {
  const inboxDir = join(getPrloomDir(repoRoot), INBOX_DIR);
  if (!existsSync(inboxDir)) {
    return [];
  }

  return readdirSync(inboxDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));
}

export function deleteInboxPlan(repoRoot: string, planId: string): void {
  const inboxPath = getInboxPath(repoRoot, planId);
  if (existsSync(inboxPath)) {
    unlinkSync(inboxPath);
  }
  const metaPath = inboxPath.replace(/\.md$/, ".json");
  if (existsSync(metaPath)) {
    unlinkSync(metaPath);
  }
}

// Plan metadata helpers

export function getPlanMeta(repoRoot: string, planId: string): PlanState {
  const state = loadState(repoRoot);
  return state.plans[planId] ?? { status: "draft" };
}

export function setPlanStatus(
  repoRoot: string,
  planId: string,
  status: PlanState["status"],
): void {
  const state = loadState(repoRoot);
  const existing = state.plans[planId] ?? { status: "draft" };
  state.plans[planId] = { ...existing, status };
  saveState(repoRoot, state);
}

export function deletePlanMeta(repoRoot: string, planId: string): void {
  const state = loadState(repoRoot);
  delete state.plans[planId];
  saveState(repoRoot, state);
}

// =============================================================================
// Source-based Plan Lookup
// =============================================================================

/**
 * Find a plan by its external source identity.
 * Searches both inbox and worktree plans.
 *
 * @returns The plan ID and state if found, undefined otherwise.
 */
export function findPlanBySource(
  repoRoot: string,
  source: PlanSource,
): { planId: string; state: PlanState } | undefined {
  const state = loadState(repoRoot);

  for (const [planId, planState] of Object.entries(state.plans)) {
    if (
      planState.source &&
      planState.source.system === source.system &&
      planState.source.kind === source.kind &&
      planState.source.id === source.id
    ) {
      return { planId, state: planState };
    }
  }

  return undefined;
}
