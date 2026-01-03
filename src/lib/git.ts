import { execa } from "execa";
import { join } from "path";
import { existsSync } from "fs";
import { nanoid } from "nanoid";

export async function branchExists(
  repoRoot: string,
  planId: string
): Promise<boolean> {
  try {
    const { stdout } = await execa("git", ["branch", "--list", `${planId}-*`], {
      cwd: repoRoot,
    });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function createBranchName(planId: string): Promise<string> {
  const hash = nanoid(5);
  return `${planId}-${hash}`;
}

export async function createWorktree(
  repoRoot: string,
  worktreesDir: string,
  branch: string
): Promise<string> {
  const worktreePath = join(worktreesDir, branch);

  if (!existsSync(worktreesDir)) {
    await execa("mkdir", ["-p", worktreesDir]);
  }

  // Create branch and worktree
  await execa("git", ["worktree", "add", "-b", branch, worktreePath], {
    cwd: repoRoot,
  });

  return worktreePath;
}

export async function commitAll(
  worktreePath: string,
  message: string
): Promise<boolean> {
  try {
    // Stage all changes
    await execa("git", ["add", "-A"], { cwd: worktreePath });

    // Check if there are changes to commit
    const { stdout } = await execa("git", ["status", "--porcelain"], {
      cwd: worktreePath,
    });

    if (!stdout.trim()) {
      return false; // Nothing to commit
    }

    await execa("git", ["commit", "-m", message], { cwd: worktreePath });
    return true;
  } catch {
    return false;
  }
}

export async function push(
  worktreePath: string,
  branch: string
): Promise<void> {
  await execa("git", ["push", "-u", "origin", branch], { cwd: worktreePath });
}

export async function hasCommits(
  repoRoot: string,
  branch: string
): Promise<boolean> {
  try {
    const { stdout } = await execa(
      "git",
      ["log", "--oneline", `main..${branch}`, "-1"],
      { cwd: repoRoot }
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function getCurrentBranch(worktreePath: string): Promise<string> {
  const { stdout } = await execa("git", ["branch", "--show-current"], {
    cwd: worktreePath,
  });
  return stdout.trim();
}
