import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  createBranchName,
  createWorktree,
  parseGitRemoteToGitHubUrl,
} from "../../src/lib/git.js";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

// Integration tests for createWorktree require a real git repo
describe("createWorktree", () => {
  const testDir = join("/tmp", `prloom-git-test-${Date.now()}`);
  const repoDir = join(testDir, "repo");
  const worktreesDir = join(testDir, "worktrees");

  beforeEach(() => {
    // Create test directory and initialize a git repo
    mkdirSync(repoDir, { recursive: true });
    execSync("git init", { cwd: repoDir });
    execSync("git config user.email 'test@test.com'", { cwd: repoDir });
    execSync("git config user.name 'Test'", { cwd: repoDir });
    // Create initial commit so we have a branch to work with
    execSync("touch README.md", { cwd: repoDir });
    execSync("git add .", { cwd: repoDir });
    execSync("git commit -m 'initial'", { cwd: repoDir });
    // Create a fake remote (itself) so fetch works
    execSync("git remote add origin " + repoDir, { cwd: repoDir });
  });

  afterEach(() => {
    // Cleanup
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("returns object with worktreePath and branch", async () => {
    const result = await createWorktree(
      repoDir,
      worktreesDir,
      "test-branch",
      "main"
    );

    expect(result).toHaveProperty("worktreePath");
    expect(result).toHaveProperty("branch");
    expect(result.branch).toBe("test-branch");
    expect(result.worktreePath).toBe(join(worktreesDir, "test-branch"));
    expect(existsSync(result.worktreePath)).toBe(true);
  });

  test("retries with suffix when branch already exists", async () => {
    // Create a branch first
    execSync("git branch existing-branch", { cwd: repoDir });

    const result = await createWorktree(
      repoDir,
      worktreesDir,
      "existing-branch",
      "main"
    );

    // Branch should have a suffix
    expect(result.branch).not.toBe("existing-branch");
    expect(result.branch).toMatch(/^existing-branch-[a-z0-9]+$/);
    expect(result.worktreePath).toBe(join(worktreesDir, result.branch));
    expect(existsSync(result.worktreePath)).toBe(true);
  });

  test("retries with suffix when worktree directory already exists", async () => {
    // Create the worktree directory manually
    mkdirSync(join(worktreesDir, "blocked-path"), { recursive: true });

    const result = await createWorktree(
      repoDir,
      worktreesDir,
      "blocked-path",
      "main"
    );

    // Should get a suffixed name since directory existed
    expect(result.branch).not.toBe("blocked-path");
    expect(result.branch).toMatch(/^blocked-path-[a-z0-9]+$/);
    expect(existsSync(result.worktreePath)).toBe(true);
  });
});

test("createBranchName slugifies input", async () => {
  const name = "My Cool Feature! (v1)";
  const branch = await createBranchName(name);

  expect(branch).toBe("my-cool-feature-v1");
});

test("createBranchName handles special characters", async () => {
  const name = "feature/api_v2";
  const branch = await createBranchName(name);

  expect(branch).toBe("feature/api_v2");
});

test("createBranchName handles empty leading/trailing dashes", async () => {
  const name = "--feature-name--";
  const branch = await createBranchName(name);

  expect(branch).toBe("feature-name");
});

describe("parseGitRemoteToGitHubUrl", () => {
  test("parses SSH URL with .git suffix", () => {
    const result = parseGitRemoteToGitHubUrl("git@github.com:owner/repo.git");
    expect(result).toBe("https://github.com/owner/repo");
  });

  test("parses SSH URL without .git suffix", () => {
    const result = parseGitRemoteToGitHubUrl("git@github.com:owner/repo");
    expect(result).toBe("https://github.com/owner/repo");
  });

  test("parses HTTPS URL with .git suffix", () => {
    const result = parseGitRemoteToGitHubUrl(
      "https://github.com/owner/repo.git"
    );
    expect(result).toBe("https://github.com/owner/repo");
  });

  test("parses HTTPS URL without .git suffix", () => {
    const result = parseGitRemoteToGitHubUrl("https://github.com/owner/repo");
    expect(result).toBe("https://github.com/owner/repo");
  });

  test("handles whitespace in URL", () => {
    const result = parseGitRemoteToGitHubUrl(
      "  git@github.com:owner/repo.git\n"
    );
    expect(result).toBe("https://github.com/owner/repo");
  });

  test("returns null for non-GitHub SSH URL", () => {
    const result = parseGitRemoteToGitHubUrl("git@gitlab.com:owner/repo.git");
    expect(result).toBeNull();
  });

  test("returns null for non-GitHub HTTPS URL", () => {
    const result = parseGitRemoteToGitHubUrl(
      "https://gitlab.com/owner/repo.git"
    );
    expect(result).toBeNull();
  });

  test("returns null for empty string", () => {
    const result = parseGitRemoteToGitHubUrl("");
    expect(result).toBeNull();
  });
});
