import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { createWorktree, copyFileToWorktree } from "../../src/lib/git.js";
import { execa } from "execa";

describe("worktree initialization", () => {
  const testDir = join("/tmp", `prloom-worktree-init-test-${Date.now()}`);
  const repoDir = join(testDir, "repo");
  const worktreesDir = join(testDir, "worktrees");

  beforeEach(() => {
    mkdirSync(repoDir, { recursive: true });
    execSync("git init", { cwd: repoDir });
    execSync("git config user.email 'test@test.com'", { cwd: repoDir });
    execSync("git config user.name 'Test'", { cwd: repoDir });
    execSync("touch README.md", { cwd: repoDir });
    execSync("git add .", { cwd: repoDir });
    execSync("git commit -m 'initial'", { cwd: repoDir });
    execSync("git remote add origin " + repoDir, { cwd: repoDir });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("copyFileToWorktree", () => {
    test("copies file from repo root to worktree", async () => {
      // Create a .env file in repo root
      writeFileSync(join(repoDir, ".env"), "SECRET=test123");

      // Create worktree
      const { worktreePath } = await createWorktree(
        repoDir,
        worktreesDir,
        "test-branch",
        "main"
      );

      // Copy file
      copyFileToWorktree(join(repoDir, ".env"), worktreePath, ".env");

      // Verify file exists and has correct content
      const copiedPath = join(worktreePath, ".env");
      expect(existsSync(copiedPath)).toBe(true);
      expect(readFileSync(copiedPath, "utf-8")).toBe("SECRET=test123");
    });

    test("copies file to nested directory in worktree", async () => {
      // Create nested file in repo
      mkdirSync(join(repoDir, "secrets"), { recursive: true });
      writeFileSync(join(repoDir, "secrets", "dev.key"), "key-content");

      // Create worktree
      const { worktreePath } = await createWorktree(
        repoDir,
        worktreesDir,
        "test-branch-2",
        "main"
      );

      // Copy file to nested path
      copyFileToWorktree(
        join(repoDir, "secrets", "dev.key"),
        worktreePath,
        "secrets/dev.key"
      );

      // Verify file exists
      const copiedPath = join(worktreePath, "secrets", "dev.key");
      expect(existsSync(copiedPath)).toBe(true);
      expect(readFileSync(copiedPath, "utf-8")).toBe("key-content");
    });
  });

  describe("initCommands execution", () => {
    test("runs shell command in worktree directory", async () => {
      // Create worktree
      const { worktreePath } = await createWorktree(
        repoDir,
        worktreesDir,
        "init-cmd-test",
        "main"
      );

      // Run a command that creates a file
      await execa("touch initialized.txt", { cwd: worktreePath, shell: true });

      // Verify file was created in worktree
      expect(existsSync(join(worktreePath, "initialized.txt"))).toBe(true);
    });

    test("runs command with arguments", async () => {
      // Create worktree
      const { worktreePath } = await createWorktree(
        repoDir,
        worktreesDir,
        "init-cmd-args-test",
        "main"
      );

      // Run echo command that writes to file
      await execa("echo 'hello world' > output.txt", {
        cwd: worktreePath,
        shell: true,
      });

      // Verify output
      const content = readFileSync(join(worktreePath, "output.txt"), "utf-8");
      expect(content.trim()).toBe("hello world");
    });

    test("failed command throws error", async () => {
      // Create worktree
      const { worktreePath } = await createWorktree(
        repoDir,
        worktreesDir,
        "init-cmd-fail-test",
        "main"
      );

      // Run command that will fail
      let threw = false;
      try {
        await execa("exit 1", { cwd: worktreePath, shell: true });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });
});
