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

export async function createBranchName(baseName: string): Promise<string> {
  // Ensure the baseName is branch-safe (very basic slugify)
  const safeName = baseName
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const hash = nanoid(5);
  return `${safeName}-${hash}`.toLowerCase();
}

export async function createWorktree(
  repoRoot: string,
  worktreesDir: string,
  branch: string,
  baseBranch: string,
  remoteName: string = "origin"
): Promise<string> {
  const worktreePath = join(worktreesDir, branch);

  if (!existsSync(worktreesDir)) {
    mkdirSync(worktreesDir, { recursive: true });
  }

  // Ensure the base branch exists on the remote and is up-to-date.
  await execa("git", ["fetch", remoteName, baseBranch], { cwd: repoRoot });

  // Create branch from remote base branch and add worktree.
  await execa(
    "git",
    [
      "worktree",
      "add",
      "-b",
      branch,
      worktreePath,
      `${remoteName}/${baseBranch}`,
    ],
    {
      cwd: repoRoot,
    }
  );

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
  baseBranch: string,
  branch: string
): Promise<boolean> {
  try {
    const { stdout } = await execa(
      "git",
      ["log", "--oneline", `${baseBranch}..${branch}`, "-1"],
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

export async function ensureRemoteBranchExists(
  repoRoot: string,
  branch: string,
  remoteName: string = "origin"
): Promise<void> {
  if (!branch) {
    throw new Error("Branch name is required");
  }

  try {
    const { stdout } = await execa(
      "git",
      ["rev-parse", "--verify", `refs/remotes/${remoteName}/${branch}`],
      { cwd: repoRoot }
    );
    if (stdout.trim()) return;
  } catch {
    // ignore
  }

  throw new Error(
    `Remote branch not found: ${remoteName}/${branch}. Push it first (git push -u ${remoteName} ${branch}).`
  );
}

// Rebase and force push

export interface RebaseResult {
  success: boolean;
  hasConflicts: boolean;
  conflictFiles?: string[];
}

export async function rebaseOnBaseBranch(
  worktreePath: string,
  baseBranch: string
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

// Ensure prloom/.local directory exists in worktree

export function ensureWorktreePrloomDir(worktreePath: string): void {
  const prloomDir = join(worktreePath, "prloom", ".local");
  if (!existsSync(prloomDir)) {
    mkdirSync(prloomDir, { recursive: true });
  }
}
