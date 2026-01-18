/**
 * E2E Test Harness
 *
 * Provides utilities for setting up temporary git repositories and
 * fake CLI shims for E2E testing of the dispatcher.
 *
 * See RFC: docs/e2e-tests.md
 */

import { mkdirSync, writeFileSync, rmSync, existsSync, chmodSync, readFileSync, appendFileSync } from "fs";
import { join } from "path";
import { execa } from "execa";
import { nanoid } from "nanoid";

// Set to true to preserve temp directories on test failure for debugging
const KEEP_TEMP_DIR = false;

export interface TempRepoResult {
  repoRoot: string;
  remoteDir: string;
  binDir: string;
  stateDir: string;
  logsDir: string;
  envOverrides: Record<string, string>;
  cleanup: () => void;
}

export interface TestLogger {
  info: (msg: string, planId?: string) => void;
  success: (msg: string, planId?: string) => void;
  warn: (msg: string, planId?: string) => void;
  error: (msg: string, planId?: string) => void;
}

export interface TestLoggerResult {
  logger: TestLogger;
  logs: { level: string; msg: string; planId?: string }[];
  getLogFile: () => string;
}

/**
 * Create a temporary git repository for E2E testing.
 *
 * Sets up:
 * - A git repository with initial commit
 * - A bare remote for offline push operations
 * - Shim binaries directory
 * - Shim state directory
 * - Logs directory
 *
 * @returns Repository paths and cleanup function
 */
export async function makeTempRepo(): Promise<TempRepoResult> {
  const id = nanoid(8);
  const baseDir = `/tmp/prloom-e2e-${id}`;
  const repoRoot = join(baseDir, "repo");
  const remoteDir = join(baseDir, "remote.git");
  const binDir = join(baseDir, "bin");
  const stateDir = join(baseDir, "state");
  const logsDir = join(baseDir, "logs");

  // Create directories
  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(remoteDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });

  // Initialize bare remote
  await execa("git", ["init", "--bare"], { cwd: remoteDir });

  // Initialize repository
  await execa("git", ["init"], { cwd: repoRoot });
  await execa("git", ["config", "user.email", "test@prloom.test"], { cwd: repoRoot });
  await execa("git", ["config", "user.name", "Test Bot"], { cwd: repoRoot });

  // Create initial file and commit
  writeFileSync(join(repoRoot, "README.md"), "# Test Repository\n");
  await execa("git", ["add", "README.md"], { cwd: repoRoot });
  await execa("git", ["commit", "-m", "Initial commit"], { cwd: repoRoot });

  // Set up remote
  await execa("git", ["remote", "add", "origin", remoteDir], { cwd: repoRoot });
  await execa("git", ["push", "-u", "origin", "main"], { cwd: repoRoot });

  // Create environment overrides
  const envOverrides: Record<string, string> = {
    PATH: `${binDir}:${process.env.PATH}`,
    E2E_STATE_DIR: stateDir,
  };

  const cleanup = () => {
    if (!KEEP_TEMP_DIR) {
      rmSync(baseDir, { recursive: true, force: true });
    } else {
      console.log(`[E2E] Temp dir preserved: ${baseDir}`);
    }
  };

  return {
    repoRoot,
    remoteDir,
    binDir,
    stateDir,
    logsDir,
    envOverrides,
    cleanup,
  };
}

/**
 * Create fake CLI binaries (gh, opencode) in the given bin directory.
 *
 * These shims record calls and simulate successful execution
 * for E2E testing without hitting real services.
 *
 * @param binDir Directory to create shims in
 * @param stateDir Directory for shim state files
 */
export function makeFakeBinaries(binDir: string, stateDir: string): void {
  // Create gh shim
  const ghShim = createGhShim();
  const ghPath = join(binDir, "gh");
  writeFileSync(ghPath, ghShim);
  chmodSync(ghPath, 0o755);

  // Create opencode shim
  const opencodeShim = createOpencodeShim();
  const opencodePath = join(binDir, "opencode");
  writeFileSync(opencodePath, opencodeShim);
  chmodSync(opencodePath, 0o755);
}

/**
 * Create a test logger that captures log output for assertions.
 */
export function createTestLogger(logFile: string): TestLoggerResult {
  const logs: { level: string; msg: string; planId?: string }[] = [];

  const write = (level: string, msg: string, planId?: string) => {
    logs.push({ level, msg, planId });
    appendFileSync(logFile, JSON.stringify({ level, msg, planId, ts: new Date().toISOString() }) + "\n");
  };

  return {
    logger: {
      info: (msg: string, planId?: string) => write("info", msg, planId),
      success: (msg: string, planId?: string) => write("success", msg, planId),
      warn: (msg: string, planId?: string) => write("warn", msg, planId),
      error: (msg: string, planId?: string) => write("error", msg, planId),
    },
    logs,
    getLogFile: () => logFile,
  };
}

/**
 * Read trace entries from the E2E trace file.
 */
export function readTraceFile(worktreePath: string): Array<{
  hook: string;
  planId?: string;
  todoCompleted?: string;
  ts: string;
  // Extended properties from failing/throwing shims
  failed?: boolean;
  action?: string;
  attempt?: number;
}> {
  const tracePath = join(worktreePath, "prloom", ".local", "e2e-trace.jsonl");
  if (!existsSync(tracePath)) {
    return [];
  }

  const content = readFileSync(tracePath, "utf-8");
  return content
    .trim()
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

/**
 * Read the gh shim state file.
 */
export function readGhState(stateDir: string): {
  prs: Record<number, { state: string; title: string; body: string; branch: string; base: string; draft?: boolean }>;
  calls: Array<{ cmd: string; args: string[]; ts: string }>;
} {
  const statePath = join(stateDir, "gh_state.json");
  if (!existsSync(statePath)) {
    return { prs: {}, calls: [] };
  }

  return JSON.parse(readFileSync(statePath, "utf-8"));
}

// =============================================================================
// Shim Generators
// =============================================================================

/**
 * Generate the gh shim script.
 *
 * Supports:
 * - gh api user --jq ...
 * - gh pr create --draft ...
 * - gh pr edit <n> --body ...
 * - gh pr ready <n>
 * - gh pr view <n> --json state -q .state
 */
function createGhShim(): string {
  return `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const stateDir = process.env.E2E_STATE_DIR || "/tmp/prloom-e2e-state";
const statePath = path.join(stateDir, "gh_state.json");

// Initialize state
let state = { prs: {}, calls: [], nextPrNumber: 1 };
if (fs.existsSync(statePath)) {
  try {
    state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
  } catch {}
}

// Save state
function saveState() {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

// Log call
function logCall(cmd, args) {
  state.calls.push({ cmd, args, ts: new Date().toISOString() });
  saveState();
}

const args = process.argv.slice(2);
const cmd = args[0];

logCall(cmd, args);

if (cmd === "api") {
  const endpoint = args[1];
  
  // gh api user --jq '{id: .id, login: .login}'
  if (endpoint === "user") {
    console.log(JSON.stringify({ id: 1, login: "test-bot" }));
    process.exit(0);
  }
  
  // gh api repos/{owner}/{repo}/issues/<n>/comments
  if (endpoint.includes("/issues/") && endpoint.includes("/comments") && !args.includes("--method")) {
    console.log(""); // No comments
    process.exit(0);
  }
  
  // gh api repos/{owner}/{repo}/pulls/<n>/reviews
  if (endpoint.includes("/pulls/") && endpoint.includes("/reviews") && !args.includes("--method")) {
    console.log(""); // No reviews
    process.exit(0);
  }
  
  // gh api repos/{owner}/{repo}/pulls/<n>/comments
  if (endpoint.includes("/pulls/") && endpoint.includes("/comments") && !args.includes("--method")) {
    console.log(""); // No comments
    process.exit(0);
  }
  
  // POST for comments/reviews - just succeed
  if (args.includes("--method") && args.includes("POST")) {
    console.log(JSON.stringify({ id: Date.now() }));
    process.exit(0);
  }
  
  process.exit(0);
}

if (cmd === "pr") {
  const subCmd = args[1];
  
  // gh pr create --draft --title <t> --body <b> --head <branch> --base <base>
  if (subCmd === "create") {
    const prNumber = state.nextPrNumber++;
    const titleIdx = args.indexOf("--title");
    const bodyIdx = args.indexOf("--body");
    const headIdx = args.indexOf("--head");
    const baseIdx = args.indexOf("--base");
    
    state.prs[prNumber] = {
      state: "OPEN",
      title: titleIdx >= 0 ? args[titleIdx + 1] : "Untitled",
      body: bodyIdx >= 0 ? args[bodyIdx + 1] : "",
      branch: headIdx >= 0 ? args[headIdx + 1] : "",
      base: baseIdx >= 0 ? args[baseIdx + 1] : "main",
      draft: args.includes("--draft"),
    };
    
    saveState();
    console.log(\`https://github.com/test/repo/pull/\${prNumber}\`);
    process.exit(0);
  }
  
  // gh pr edit <n> --body <b>
  if (subCmd === "edit") {
    const prNumber = parseInt(args[2], 10);
    const bodyIdx = args.indexOf("--body");
    
    if (state.prs[prNumber] && bodyIdx >= 0) {
      state.prs[prNumber].body = args[bodyIdx + 1];
      saveState();
    }
    process.exit(0);
  }
  
  // gh pr ready <n>
  if (subCmd === "ready") {
    const prNumber = parseInt(args[2], 10);
    if (state.prs[prNumber]) {
      state.prs[prNumber].draft = false;
    }
    saveState();
    process.exit(0);
  }
  
  // gh pr view <n> --json state -q .state
  if (subCmd === "view") {
    const prNumber = parseInt(args[2], 10);
    const pr = state.prs[prNumber];
    console.log(pr ? pr.state : "OPEN");
    process.exit(0);
  }
}

// Unknown command - succeed silently
process.exit(0);
`;
}

/**
 * Generate the opencode shim script.
 *
 * Behavior:
 * 1. Find plan.md in ./prloom/.local/plan.md (cwd is worktree)
 * 2. Mark first unchecked TODO as checked
 * 3. Modify e2e.txt to ensure there's a change to commit
 * 4. Write to trace file for hook ordering assertions
 */
function createOpencodeShim(): string {
  return `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

// The shim runs with cwd set to the worktree
const cwd = process.cwd();
const planPath = path.join(cwd, "prloom", ".local", "plan.md");
const tracePath = path.join(cwd, "prloom", ".local", "e2e-trace.jsonl");
const changeFile = path.join(cwd, "e2e.txt");

// Parse command line to extract plan info
const args = process.argv.slice(2);

// Write trace entry
function appendTrace(entry) {
  fs.mkdirSync(path.dirname(tracePath), { recursive: true });
  fs.appendFileSync(tracePath, JSON.stringify({ ...entry, ts: new Date().toISOString() }) + "\\n");
}

// Read plan
if (!fs.existsSync(planPath)) {
  console.error("[opencode shim] Plan file not found:", planPath);
  process.exit(1);
}

let plan = fs.readFileSync(planPath, "utf-8");

// Find first unchecked TODO and mark it done
// Pattern: "- [ ] Task text" -> "- [x] Task text"
const todoPattern = /^(\\s*-\\s*)\\[\\s*\\](\\s+.+)$/m;
const match = plan.match(todoPattern);

if (match) {
  plan = plan.replace(todoPattern, "$1[x]$2");
  fs.writeFileSync(planPath, plan);
  
  // Write trace entry
  appendTrace({ hook: "worker" });
  
  // Modify e2e.txt to create a committable change
  const changeContent = fs.existsSync(changeFile) 
    ? fs.readFileSync(changeFile, "utf-8") 
    : "";
  fs.writeFileSync(changeFile, changeContent + \`Change at \${new Date().toISOString()}\\n\`);
  
  console.log("[opencode shim] Marked TODO as complete");
  process.exit(0);
} else {
  console.log("[opencode shim] No unchecked TODOs found");
  process.exit(0);
}
`;
}

// =============================================================================
// Test Plugin Generator
// =============================================================================

/**
 * Create a test plugin that writes to the trace file.
 *
 * @param pluginsDir Directory to write the plugin to
 * @returns Path to the created plugin
 */
export function createTracePlugin(pluginsDir: string): string {
  const pluginContent = `
const fs = require("fs");
const path = require("path");

module.exports = function plugin(config) {
  const appendTrace = (worktree, entry) => {
    const tracePath = path.join(worktree, "prloom", ".local", "e2e-trace.jsonl");
    fs.mkdirSync(path.dirname(tracePath), { recursive: true });
    fs.appendFileSync(tracePath, JSON.stringify({ ...entry, ts: new Date().toISOString() }) + "\\n");
  };

  return {
    beforeTodo: async (plan, ctx) => {
      appendTrace(ctx.worktree, { hook: "beforeTodo", planId: ctx.planId });
      return plan;
    },
    afterTodo: async (plan, ctx) => {
      appendTrace(ctx.worktree, { hook: "afterTodo", planId: ctx.planId, todoCompleted: ctx.todoCompleted });
      return plan;
    },
    beforeFinish: async (plan, ctx) => {
      appendTrace(ctx.worktree, { hook: "beforeFinish", planId: ctx.planId });
      return plan;
    },
    afterFinish: async (plan, ctx) => {
      appendTrace(ctx.worktree, { hook: "afterFinish", planId: ctx.planId });
      // Example: emit an action to the bus
      ctx.emitAction({ 
        id: "e2e-notify-" + Date.now(),
        type: "respond", 
        target: { target: "console" },
        payload: { type: "notification", message: "Plan finished" }
      });
      return plan;
    },
  };
};
`;

  mkdirSync(pluginsDir, { recursive: true });
  const pluginPath = join(pluginsDir, "e2e-hooks.js");
  writeFileSync(pluginPath, pluginContent);
  return pluginPath;
}

/**
 * Create a plugin that blocks finishing by adding a TODO in beforeFinish.
 */
export function createBlockingPlugin(pluginsDir: string): string {
  const pluginContent = `
const fs = require("fs");
const path = require("path");

module.exports = function plugin(config) {
  const appendTrace = (worktree, entry) => {
    const tracePath = path.join(worktree, "prloom", ".local", "e2e-trace.jsonl");
    fs.mkdirSync(path.dirname(tracePath), { recursive: true });
    fs.appendFileSync(tracePath, JSON.stringify({ ...entry, ts: new Date().toISOString() }) + "\\n");
  };

  return {
    beforeFinish: async (plan, ctx) => {
      appendTrace(ctx.worktree, { hook: "beforeFinish", planId: ctx.planId, action: "blocking" });
      
      // Add a new TODO to prevent finishing
      // Insert after "## TODO" line
      const todoMarker = "## TODO";
      const idx = plan.indexOf(todoMarker);
      if (idx >= 0) {
        const insertPos = idx + todoMarker.length;
        const before = plan.slice(0, insertPos);
        const after = plan.slice(insertPos);
        return before + "\\n\\n- [ ] Added by beforeFinish hook" + after;
      }
      return plan;
    },
  };
};
`;

  mkdirSync(pluginsDir, { recursive: true });
  const pluginPath = join(pluginsDir, "blocking-plugin.js");
  writeFileSync(pluginPath, pluginContent);
  return pluginPath;
}

// =============================================================================
// Test Setup Helpers
// =============================================================================

/**
 * Write a test configuration file.
 */
export function writeTestConfig(
  repoRoot: string,
  config: Record<string, unknown>
): void {
  const configDir = join(repoRoot, "prloom");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "config.json"), JSON.stringify(config, null, 2));
}

import { buildPlanContent } from "../plan_helper.js";
export { buildPlanContent };

/**
 * Write an inbox plan and mark it as queued.
 */
export function writeInboxPlan(
  repoRoot: string,
  planId: string,
  planContent: string,
  agent: string = "opencode"
): void {
  const inboxDir = join(repoRoot, "prloom", ".local", "inbox");
  mkdirSync(inboxDir, { recursive: true });

  // Write plan markdown
  writeFileSync(join(inboxDir, `${planId}.md`), planContent);

  // Write metadata JSON (queued status)
  writeFileSync(
    join(inboxDir, `${planId}.json`),
    JSON.stringify({ status: "queued", agent }, null, 2)
  );
}

/**
 * Get git log output for a worktree.
 */
export async function getGitLog(
  worktreePath: string,
  count: number = 10
): Promise<string[]> {
  try {
    const { stdout } = await execa(
      "git",
      ["log", "--oneline", `-${count}`],
      { cwd: worktreePath }
    );
    return stdout.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Apply environment overrides and return a restore function.
 */
export function applyEnvOverrides(
  overrides: Record<string, string>
): () => void {
  const original: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(overrides)) {
    original[key] = process.env[key];
    process.env[key] = value;
  }

  return () => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

/**
 * Create a "failing" opencode shim that does NOT mark TODOs complete.
 * Used for testing retry/blocking behavior.
 */
export function createFailingOpencodeShim(binDir: string): void {
  const shim = `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

// The shim runs with cwd set to the worktree
const cwd = process.cwd();
const tracePath = path.join(cwd, "prloom", ".local", "e2e-trace.jsonl");
const changeFile = path.join(cwd, "e2e.txt");

// Write trace entry
function appendTrace(entry) {
  fs.mkdirSync(path.dirname(tracePath), { recursive: true });
  fs.appendFileSync(tracePath, JSON.stringify({ ...entry, ts: new Date().toISOString() }) + "\\n");
}

// Write trace entry for the failed attempt
appendTrace({ hook: "worker", failed: true });

// Modify e2e.txt to create a committable change (but don't mark TODO done)
const changeContent = fs.existsSync(changeFile) 
  ? fs.readFileSync(changeFile, "utf-8") 
  : "";
fs.writeFileSync(changeFile, changeContent + \`Failed attempt at \${new Date().toISOString()}\\n\`);

console.log("[opencode shim] Simulating failure - NOT marking TODO complete");
process.exit(0);
`;

  const opencodePath = join(binDir, "opencode");
  writeFileSync(opencodePath, shim);
  chmodSync(opencodePath, 0o755);
}

/**
 * Create a plugin that throws an error.
 * Used for testing hook error handling.
 */
export function createThrowingPlugin(pluginsDir: string, hookPoint: string = "beforeTodo"): string {
  const pluginContent = `
const fs = require("fs");
const path = require("path");

module.exports = function plugin(config) {
  const appendTrace = (worktree, entry) => {
    const tracePath = path.join(worktree, "prloom", ".local", "e2e-trace.jsonl");
    fs.mkdirSync(path.dirname(tracePath), { recursive: true });
    fs.appendFileSync(tracePath, JSON.stringify({ ...entry, ts: new Date().toISOString() }) + "\\n");
  };

  return {
    ${hookPoint}: async (plan, ctx) => {
      appendTrace(ctx.worktree, { hook: "${hookPoint}", planId: ctx.planId, action: "throwing" });
      throw new Error("E2E test: intentional hook error");
    },
  };
};
`;

  mkdirSync(pluginsDir, { recursive: true });
  const pluginPath = join(pluginsDir, "throwing-plugin.js");
  writeFileSync(pluginPath, pluginContent);
  return pluginPath;
}
