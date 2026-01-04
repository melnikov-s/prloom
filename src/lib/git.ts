import { execa } from "execa";
import { join, dirname } from "path";
import { existsSync, copyFileSync, mkdirSync } from "fs";
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
    mkdirSync(worktreesDir, { recursive: true });
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

// Rebase and force push

export interface RebaseResult {
  success: boolean;
  hasConflicts: boolean;
  conflictFiles?: string[];
}

export async function rebaseOnMain(
  worktreePath: string,
  baseBranch: string = "main"
): Promise<RebaseResult> {
  try {
    // Fetch latest from origin
    await execa("git", ["fetch", "origin", baseBranch], { cwd: worktreePath });

    // Attempt rebase
    await execa("git", ["rebase", `origin/${baseBranch}`], {
      cwd: worktreePath,
    });

    return { success: true, hasConflicts: false };
  } catch (error) {
    // Check for conflicts
    try {
      const { stdout } = await execa(
        "git",
        ["diff", "--name-only", "--diff-filter=U"],
        { cwd: worktreePath }
      );

      if (stdout.trim()) {
        // Abort the rebase
        await execa("git", ["rebase", "--abort"], { cwd: worktreePath });
        return {
          success: false,
          hasConflicts: true,
          conflictFiles: stdout.trim().split("\n"),
        };
      }
    } catch {
      // Ignore errors checking for conflicts
    }

    return { success: false, hasConflicts: false };
  }
}

export async function forcePush(
  worktreePath: string,
  branch: string
): Promise<void> {
  await execa("git", ["push", "--force-with-lease", "origin", branch], {
    cwd: worktreePath,
  });
}

// Copy file to worktree

export function copyFileToWorktree(
  srcPath: string,
  worktreePath: string,
  destRelPath: string
): void {
  const destPath = join(worktreePath, destRelPath);
  const destDir = dirname(destPath);

  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  copyFileSync(srcPath, destPath);
}

// Ensure .swarm directory exists in worktree

export function ensureWorktreeSwarmDir(worktreePath: string): void {
  const swarmDir = join(worktreePath, ".swarm");
  if (!existsSync(swarmDir)) {
    mkdirSync(swarmDir, { recursive: true });
  }
}
