import { execa } from "execa";
import { join, dirname } from "path";
import { existsSync, copyFileSync, mkdirSync } from "fs";

/**
 * Parse a git remote URL to a GitHub web URL.
 * Exported for testing.
 */
export function parseGitRemoteToGitHubUrl(remoteUrl: string): string | null {
  const url = remoteUrl.trim();

  // Handle SSH format: git@github.com:owner/repo.git
  if (url.startsWith("git@github.com:")) {
    const path = url.replace("git@github.com:", "").replace(/\.git$/, "");
    return `https://github.com/${path}`;
  }

  // Handle HTTPS format: https://github.com/owner/repo.git
  if (url.startsWith("https://github.com/")) {
    return url.replace(/\.git$/, "");
  }

  return null;
}

/**
 * Get the GitHub web URL for the repository (e.g., https://github.com/owner/repo)
 */
export async function getGitHubRepoUrl(
  repoRoot: string
): Promise<string | null> {
  try {
    const { stdout } = await execa("git", ["remote", "get-url", "origin"], {
      cwd: repoRoot,
    });
    return parseGitRemoteToGitHubUrl(stdout);
  } catch {
    return null;
  }
}

export async function createBranchName(baseName: string): Promise<string> {
  // Ensure the baseName is branch-safe (very basic slugify)
  const safeName = baseName
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return safeName.toLowerCase();
}

export interface CreateWorktreeResult {
  worktreePath: string;
  branch: string;
}

export async function createWorktree(
  repoRoot: string,
  worktreesDir: string,
  branch: string,
  baseBranch: string,
  remoteName: string = "origin"
): Promise<CreateWorktreeResult> {
  if (!existsSync(worktreesDir)) {
    mkdirSync(worktreesDir, { recursive: true });
  }

  // Ensure the base branch exists on the remote and is up-to-date.
  await execa("git", ["fetch", remoteName, baseBranch], { cwd: repoRoot });

  // Try creating with original branch name first
  const originalWorktreePath = join(worktreesDir, branch);

  if (!existsSync(originalWorktreePath)) {
    try {
      await execa(
        "git",
        [
          "worktree",
          "add",
          "-b",
          branch,
          originalWorktreePath,
          `${remoteName}/${baseBranch}`,
        ],
        {
          cwd: repoRoot,
        }
      );
      return { worktreePath: originalWorktreePath, branch };
    } catch (error) {
      // Check if error is due to branch already existing
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes("already exists")) {
        throw error;
      }
      // Branch exists, fall through to retry with suffix
    }
  }

  // Retry with unique suffix
  const uniqueId = Math.random().toString(36).substring(2, 7);
  const suffixedBranch = `${branch}-${uniqueId}`;
  const suffixedWorktreePath = join(worktreesDir, suffixedBranch);

  if (existsSync(suffixedWorktreePath)) {
    throw new Error(
      `Worktree directory already exists: ${suffixedWorktreePath}`
    );
  }

  await execa(
    "git",
    [
      "worktree",
      "add",
      "-b",
      suffixedBranch,
      suffixedWorktreePath,
      `${remoteName}/${baseBranch}`,
    ],
    {
      cwd: repoRoot,
    }
  );

  return { worktreePath: suffixedWorktreePath, branch: suffixedBranch };
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

/**
 * Create an empty commit (for initializing PR branches).
 */
export async function commitEmpty(
  worktreePath: string,
  message: string
): Promise<void> {
  await execa("git", ["commit", "--allow-empty", "-m", message], {
    cwd: worktreePath,
  });
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

/**
 * Remove a git worktree and its directory.
 * Uses `git worktree remove --force` to clean up.
 */
export async function removeWorktree(
  repoRoot: string,
  worktreePath: string
): Promise<void> {
  if (!existsSync(worktreePath)) {
    return;
  }

  try {
    await execa("git", ["worktree", "remove", "--force", worktreePath], {
      cwd: repoRoot,
    });
  } catch (error) {
    // If git worktree remove fails, try to prune and remove manually
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Prune stale worktree entries
    await execa("git", ["worktree", "prune"], { cwd: repoRoot });

    // If directory still exists, remove it manually
    if (existsSync(worktreePath)) {
      const { rm } = await import("fs/promises");
      await rm(worktreePath, { recursive: true, force: true });
    }
  }
}
