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
  worktree: string;
  branch: string;
  pr?: number;
  planRelpath: string; // e.g. "prloom/.local/plan.md" (gitignored)
  baseBranch: string; // e.g. "main" for rebase

  /** Plan execution status - owned by dispatcher, not frontmatter */
  status: "active" | "blocked" | "review" | "reviewing" | "done";

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

export interface InboxMeta {
  status: "draft" | "queued";
  agent?: AgentName;
}

export interface State {
  control_cursor: number;
  plans: Record<string, PlanState>;
  inbox: Record<string, InboxMeta>;
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
    return { control_cursor: 0, plans: {}, inbox: {} };
  }

  try {
    const raw = readFileSync(statePath, "utf-8");
    return JSON.parse(raw) as State;
  } catch {
    return { control_cursor: 0, plans: {}, inbox: {} };
  }
}

export function saveState(repoRoot: string, state: State): void {
  ensureSwarmDir(repoRoot);
  const statePath = join(getSwarmDir(repoRoot), STATE_FILE);
  const tempPath = statePath + ".tmp";

  writeFileSync(tempPath, JSON.stringify(state, null, 2));
  renameSync(tempPath, statePath);
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

// Inbox metadata helpers (stored in state.inbox, not sidecar files)

export function getInboxMeta(repoRoot: string, planId: string): InboxMeta {
  const state = loadState(repoRoot);
  return state.inbox[planId] ?? { status: "draft" };
}

export function setInboxStatus(
  repoRoot: string,
  planId: string,
  status: "draft" | "queued",
  agent?: AgentName
): void {
  const state = loadState(repoRoot);
  const existing = state.inbox[planId] ?? { status: "draft" };
  state.inbox[planId] = { ...existing, status, agent: agent ?? existing.agent };
  saveState(repoRoot, state);
}

export function deleteInboxMeta(repoRoot: string, planId: string): void {
  const state = loadState(repoRoot);
  delete state.inbox[planId];
  saveState(repoRoot, state);
}
