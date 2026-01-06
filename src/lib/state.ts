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

export interface PlanState {
  sessionId?: string;
  worktree: string;
  branch: string;
  pr?: number;
  planRelpath: string; // e.g. "prloom/plans/<id>.md"
  baseBranch: string; // e.g. "main" for rebase

  /** Active tmux session name when running with --tmux */
  tmuxSession?: string;

  /** Force a one-time PR feedback poll without shifting schedule */
  pollOnce?: boolean;

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
const PLANS_DIR = "plans";

function getSwarmDir(repoRoot: string): string {
  return join(repoRoot, SWARM_DIR);
}

function ensureSwarmDir(repoRoot: string): void {
  const dir = getSwarmDir(repoRoot);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const plansDir = join(dir, PLANS_DIR);
  if (!existsSync(plansDir)) {
    mkdirSync(plansDir, { recursive: true });
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
    return JSON.parse(raw);
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

// Shards

export function saveShard(
  repoRoot: string,
  planId: string,
  ps: PlanState
): void {
  ensureSwarmDir(repoRoot);
  const shardPath = join(getSwarmDir(repoRoot), PLANS_DIR, `${planId}.json`);
  const tempPath = shardPath + ".tmp";

  writeFileSync(tempPath, JSON.stringify(ps, null, 2));
  renameSync(tempPath, shardPath);
}

export function loadShard(repoRoot: string, planId: string): PlanState | null {
  const shardPath = join(getSwarmDir(repoRoot), PLANS_DIR, `${planId}.json`);

  if (!existsSync(shardPath)) {
    return null;
  }

  try {
    const raw = readFileSync(shardPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Inbox

const INBOX_DIR = "inbox";

export function ensureInboxDir(repoRoot: string): void {
  const inboxDir = join(getSwarmDir(repoRoot), INBOX_DIR);
  if (!existsSync(inboxDir)) {
    mkdirSync(inboxDir, { recursive: true });
  }
}

export function getInboxPath(repoRoot: string, planId: string): string {
  return join(getSwarmDir(repoRoot), INBOX_DIR, `${planId}.md`);
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
}
