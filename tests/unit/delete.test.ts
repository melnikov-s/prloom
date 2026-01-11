import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "fs";
import { join } from "path";
import { execSync } from "child_process";
import {
  getInboxPath,
  loadState,
  saveState,
  setPlanStatus,
  type State,
} from "../../src/lib/state.js";
import { generatePlanSkeleton } from "../../src/lib/plan.js";
import { runDelete } from "../../src/cli/delete.js";
import { setPromptIO } from "../../src/cli/prompt.js";

// Test directory for inbox-only tests (no git required)
const TEST_DIR = "/tmp/prloom-delete-test";

// Test directory for worktree tests (requires git)
let gitTestDir: string;

beforeEach(() => {
  // Setup basic test directory for inbox tests
  mkdirSync(join(TEST_DIR, "prloom", ".local", "inbox"), { recursive: true });
});

afterEach(() => {
  // Cleanup
  rmSync(TEST_DIR, { recursive: true, force: true });
  if (gitTestDir && existsSync(gitTestDir)) {
    rmSync(gitTestDir, { recursive: true, force: true });
  }
  // Reset prompt IO
  setPromptIO(null);
});

// Helper to mock confirmation prompt
function mockConfirm(response: string): void {
  const { Readable, Writable } = require("stream");
  const input = new Readable({
    read() {
      this.push(response + "\n");
      this.push(null);
    },
  });
  const output = new Writable({
    write(_chunk: Buffer, _encoding: string, callback: () => void) {
      callback();
    },
  });
  setPromptIO({ input, output });
}

describe("runDelete with inbox plans", () => {
  test("deletes inbox plan when confirmed with force flag", async () => {
    const id = "test-plan-123";
    const inboxPath = getInboxPath(TEST_DIR, id);
    writeFileSync(inboxPath, generatePlanSkeleton());
    setPlanStatus(TEST_DIR, id, "draft");

    // Verify plan exists
    expect(existsSync(inboxPath)).toBe(true);

    // Delete with force (no confirmation needed)
    await runDelete(TEST_DIR, id, true);

    // Plan should be gone
    expect(existsSync(inboxPath)).toBe(false);
  });

  test("deletes inbox plan metadata json file", async () => {
    const id = "plan-with-meta";
    const inboxPath = getInboxPath(TEST_DIR, id);
    const metaPath = inboxPath.replace(/\.md$/, ".json");

    writeFileSync(inboxPath, generatePlanSkeleton());
    setPlanStatus(TEST_DIR, id, "queued");

    // Verify both files exist
    expect(existsSync(inboxPath)).toBe(true);
    expect(existsSync(metaPath)).toBe(true);

    await runDelete(TEST_DIR, id, true);

    // Both should be deleted
    expect(existsSync(inboxPath)).toBe(false);
    expect(existsSync(metaPath)).toBe(false);
  });

  test("prompts for confirmation when force is false", async () => {
    const id = "confirm-test";
    const inboxPath = getInboxPath(TEST_DIR, id);
    writeFileSync(inboxPath, generatePlanSkeleton());
    setPlanStatus(TEST_DIR, id, "draft");

    // Mock user confirming with "y"
    mockConfirm("y");

    await runDelete(TEST_DIR, id, false);

    // Plan should be deleted after confirmation
    expect(existsSync(inboxPath)).toBe(false);
  });

  test("aborts deletion when user declines confirmation", async () => {
    const id = "decline-test";
    const inboxPath = getInboxPath(TEST_DIR, id);
    writeFileSync(inboxPath, generatePlanSkeleton());
    setPlanStatus(TEST_DIR, id, "draft");

    // Mock user declining with "n"
    mockConfirm("n");

    await runDelete(TEST_DIR, id, false);

    // Plan should still exist
    expect(existsSync(inboxPath)).toBe(true);
  });

  test("throws error for non-existent plan", async () => {
    await expect(runDelete(TEST_DIR, "nonexistent-plan", true)).rejects.toThrow(
      /Plan not found/
    );
  });
});

describe("runDelete with worktree plans", () => {
  beforeEach(() => {
    // Create a real git repo for worktree tests
    gitTestDir = `/tmp/prloom-delete-git-test-${Date.now()}`;
    const repoDir = join(gitTestDir, "repo");
    mkdirSync(repoDir, { recursive: true });

    execSync("git init", { cwd: repoDir });
    execSync("git config user.email 'test@test.com'", { cwd: repoDir });
    execSync("git config user.name 'Test'", { cwd: repoDir });
    execSync("touch README.md", { cwd: repoDir });
    execSync("git add .", { cwd: repoDir });
    execSync("git commit -m 'initial'", { cwd: repoDir });
    execSync("git remote add origin " + repoDir, { cwd: repoDir });
  });

  test("deletes worktree for active plan", async () => {
    const repoDir = join(gitTestDir, "repo");
    const worktreesDir = join(repoDir, "prloom", ".local", "worktrees");
    const worktreePath = join(worktreesDir, "test-branch");

    // Create worktree manually
    mkdirSync(worktreesDir, { recursive: true });
    execSync(`git worktree add -b test-branch ${worktreePath} HEAD`, {
      cwd: repoDir,
    });

    // Setup state directory in worktree
    mkdirSync(join(worktreePath, "prloom", ".local"), { recursive: true });

    // Save state with worktree reference
    const state: State = {
      control_cursor: 0,
      plans: {
        "active-plan": {
          worktree: worktreePath,
          branch: "test-branch",
          planRelpath: "prloom/.local/plan.md",
          baseBranch: "main",
          status: "active",
        },
      },
    };
    saveState(repoDir, state);

    // Verify worktree exists
    expect(existsSync(worktreePath)).toBe(true);

    // Delete with force
    await runDelete(repoDir, "active-plan", true);

    // Worktree should be removed
    expect(existsSync(worktreePath)).toBe(false);
  });

  test("removes worktree even when in review status", async () => {
    const repoDir = join(gitTestDir, "repo");
    const worktreesDir = join(repoDir, "prloom", ".local", "worktrees");
    const worktreePath = join(worktreesDir, "review-branch");

    mkdirSync(worktreesDir, { recursive: true });
    execSync(`git worktree add -b review-branch ${worktreePath} HEAD`, {
      cwd: repoDir,
    });

    mkdirSync(join(worktreePath, "prloom", ".local"), { recursive: true });

    const state: State = {
      control_cursor: 0,
      plans: {
        "review-plan": {
          worktree: worktreePath,
          branch: "review-branch",
          planRelpath: "prloom/.local/plan.md",
          baseBranch: "main",
          status: "review",
        },
      },
    };
    saveState(repoDir, state);

    expect(existsSync(worktreePath)).toBe(true);

    await runDelete(repoDir, "review-plan", true);

    expect(existsSync(worktreePath)).toBe(false);
  });
});

describe("runDelete confirmation behavior", () => {
  test("force flag skips confirmation for direct ID", async () => {
    const id = "force-skip";
    const inboxPath = getInboxPath(TEST_DIR, id);
    writeFileSync(inboxPath, generatePlanSkeleton());
    setPlanStatus(TEST_DIR, id, "draft");

    // No mock needed - force should skip prompt entirely
    await runDelete(TEST_DIR, id, true);

    expect(existsSync(inboxPath)).toBe(false);
  });

  test("empty response defaults to no (abort)", async () => {
    const id = "empty-response";
    const inboxPath = getInboxPath(TEST_DIR, id);
    writeFileSync(inboxPath, generatePlanSkeleton());
    setPlanStatus(TEST_DIR, id, "draft");

    // Mock empty response
    mockConfirm("");

    await runDelete(TEST_DIR, id, false);

    // Should still exist (empty = no)
    expect(existsSync(inboxPath)).toBe(true);
  });
});
