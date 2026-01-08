import { join } from "path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  readdirSync,
} from "fs";
import type { AgentName } from "./adapters/index.js";

export interface PlanState {
  /** Agent to use for this plan */
  agent?: AgentName;

  // Activation fields - only populated after plan is activated by dispatcher
  worktree?: string;
  branch?: string;
  pr?: number;
  planRelpath?: string; // e.g. "prloom/.local/plan.md" (gitignored)
  baseBranch?: string; // e.g. "main" for rebase

  /** Plan execution status - covers full lifecycle from draft to done */
  status:
    | "draft"
    | "queued"
    | "active"
    | "blocked"
    | "review"
    | "reviewing"
    | "triaging"
    | "done";

  /** Active tmux session name when running with --tmux */
  tmuxSession?: string;

  /** Active agent process PID when running without tmux */
  pid?: number;

  /** Force a one-time PR feedback poll without shifting schedule */
  pollOnce?: boolean;

  /** Flag to trigger a review agent run */
  pendingReview?: boolean;

  // Cursors for incremental PR feedback polling
  lastIssueCommentId?: number;
  lastReviewId?: number;
  lastReviewCommentId?: number;
  lastPolledAt?: string; // ISO timestamp
  lastError?: string; // For visibility in prloom status

  // Retry tracking to detect stuck TODOs
  lastTodoIndex?: number;
  todoRetryCount?: number;
}

export interface State {
  control_cursor: number;
  plans: Record<string, PlanState>;
}

const SWARM_DIR = "prloom/.local";
const STATE_FILE = "state.json";
const LOCK_FILE = "lock";

function getSwarmDir(repoRoot: string): string {
  return join(repoRoot, SWARM_DIR);
}

function ensureSwarmDir(repoRoot: string): void {
  const dir = getSwarmDir(repoRoot);
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
  ensureSwarmDir(repoRoot);
  const lockPath = join(getSwarmDir(repoRoot), LOCK_FILE);

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
  const lockPath = join(getSwarmDir(repoRoot), LOCK_FILE);
  if (existsSync(lockPath)) {
    unlinkSync(lockPath);
  }
}

// State

export function loadState(repoRoot: string): State {
  ensureSwarmDir(repoRoot);
  const statePath = join(getSwarmDir(repoRoot), STATE_FILE);

  if (!existsSync(statePath)) {
    return { control_cursor: 0, plans: {} };
  }

  try {
    const raw = readFileSync(statePath, "utf-8");
    const parsed = JSON.parse(raw);
    // Migration: merge legacy inbox into plans if present
    if (parsed.inbox && typeof parsed.inbox === "object") {
      for (const [id, meta] of Object.entries(parsed.inbox)) {
        if (!parsed.plans[id] && meta && typeof meta === "object") {
          parsed.plans[id] = meta as PlanState;
        }
      }
      delete parsed.inbox;
    }
    return parsed as State;
  } catch {
    return { control_cursor: 0, plans: {} };
  }
}

export function saveState(repoRoot: string, state: State): void {
  ensureSwarmDir(repoRoot);
  const statePath = join(getSwarmDir(repoRoot), STATE_FILE);
  const tempPath = statePath + ".tmp";

  writeFileSync(tempPath, JSON.stringify(state, null, 2));
  renameSync(tempPath, statePath);
}

// Inbox (file storage - plans waiting to be activated)

const INBOX_DIR = "inbox";

export function ensureInboxDir(repoRoot: string): void {
  const inboxDir = join(getSwarmDir(repoRoot), INBOX_DIR);
  if (!existsSync(inboxDir)) {
    mkdirSync(inboxDir, { recursive: true });
  }
}

export function getInboxPath(repoRoot: string, planId: string): string {
  const inboxDir = join(getSwarmDir(repoRoot), INBOX_DIR);
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
  const inboxDir = join(getSwarmDir(repoRoot), INBOX_DIR);
  if (!existsSync(inboxDir)) {
    return [];
  }

  const files = readdirSync(inboxDir);
  return files
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));
}

export function deleteInboxPlan(repoRoot: string, planId: string): void {
  const inboxPath = getInboxPath(repoRoot, planId);
  if (existsSync(inboxPath)) {
    unlinkSync(inboxPath);
  }
  // Also delete legacy metadata file if it exists
  const metaPath = inboxPath.replace(/\.md$/, ".json");
  if (existsSync(metaPath)) {
    unlinkSync(metaPath);
  }
}

// Plan metadata helpers (stored in state.plans)

export function getPlanMeta(repoRoot: string, planId: string): PlanState {
  const state = loadState(repoRoot);
  return state.plans[planId] ?? { status: "draft" };
}

/** @deprecated Use getPlanMeta instead */
export function getInboxMeta(repoRoot: string, planId: string): PlanState {
  return getPlanMeta(repoRoot, planId);
}

export function setPlanStatus(
  repoRoot: string,
  planId: string,
  status: PlanState["status"],
  agent?: AgentName
): void {
  const state = loadState(repoRoot);
  const existing = state.plans[planId] ?? { status: "draft" };
  state.plans[planId] = { ...existing, status, agent: agent ?? existing.agent };
  saveState(repoRoot, state);
}

/** @deprecated Use setPlanStatus instead */
export function setInboxStatus(
  repoRoot: string,
  planId: string,
  status: "draft" | "queued",
  agent?: AgentName
): void {
  setPlanStatus(repoRoot, planId, status, agent);
}

export function deletePlanMeta(repoRoot: string, planId: string): void {
  const state = loadState(repoRoot);
  delete state.plans[planId];
  saveState(repoRoot, state);
}

/** @deprecated Use deletePlanMeta instead */
export function deleteInboxMeta(repoRoot: string, planId: string): void {
  deletePlanMeta(repoRoot, planId);
}
