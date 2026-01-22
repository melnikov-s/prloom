import { execa } from "execa";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { loadConfig } from "../lib/config.js";

export interface InitOptions {
  yes?: boolean;
  force?: boolean;
}

/**
 * Check if prloom is initialized in a repository.
 * Checks for the existence of prloom/config.json.
 */
export function isInitialized(repoRoot: string): boolean {
  const configPath = join(repoRoot, "prloom", "config.json");
  return existsSync(configPath);
}

export async function runInit(
  cwd: string,
  opts: InitOptions = {},
): Promise<void> {
  const repoRoot = cwd;

  await ensureGhInstalled();
  await ensureGhAuthed();
  await ensureGhRepoResolvable(repoRoot);

  const defaultBranch = await detectDefaultBranch(repoRoot);

  // Write config if missing (or if force)
  const configPath = join(repoRoot, "prloom", "config.json");
  const prloomDir = join(repoRoot, "prloom");

  // Ensure prloom/ exists first
  mkdirSync(prloomDir, { recursive: true });

  if (!existsSync(configPath) || opts.force) {
    // Load existing (if any) so we preserve agent choices when force is used
    const existing = loadConfig(repoRoot);
    const config = {
      agents: existing.agents,
      worktrees_dir: existing.worktrees_dir,
      github_poll_interval_ms: existing.github_poll_interval_ms,
      base_branch: defaultBranch,
      // RFC: Commit Review Gate - set enabled: true to activate
      commitReview: {
        enabled: false,
        maxLoops: 2,
        requireManualResume: false,
      },
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    console.log(`Wrote ${configPath}`);
  } else {
    console.log(`Found existing ${configPath} (leaving unchanged)`);
  }

  // Ensure prloom/.local runtime directories exist
  const localDir = join(prloomDir, ".local");
  const inboxDir = join(localDir, "inbox");

  mkdirSync(inboxDir, { recursive: true });

  // Ensure gitignore
  await ensureGitignoreEntry(repoRoot, "prloom/.local/");

  console.log("✅ prloom initialized");
  console.log(`Base branch: ${defaultBranch}`);

  console.log("");
  console.log("Next: run `prloom new <id>` then `prloom`");
}

async function ensureGhInstalled(): Promise<void> {
  try {
    await execa("gh", ["--version"]);
  } catch {
    console.error("GitHub CLI (gh) is required.");
    console.error("Install from https://cli.github.com/ and rerun.");
    process.exit(1);
  }
}

async function ensureGhAuthed(): Promise<void> {
  try {
    await execa("gh", ["auth", "status"], { stdio: "ignore" });
  } catch {
    console.error("GitHub CLI is not authenticated.");
    console.error("Run `gh auth login` then rerun `prloom init`.");
    process.exit(1);
  }
}

async function ensureGhRepoResolvable(repoRoot: string): Promise<void> {
  try {
    await execa(
      "gh",
      ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
      { cwd: repoRoot, stdio: "ignore" },
    );
  } catch {
    console.error(
      "Unable to resolve the GitHub repository from this directory.",
    );
    console.error(
      "Make sure this repo has an `origin` remote pointing to GitHub.",
    );
    console.error("Then rerun `prloom init`. ");
    process.exit(1);
  }
}

async function detectDefaultBranch(repoRoot: string): Promise<string> {
  // Prefer GH's idea of default branch (works with GHE too if gh is configured)
  try {
    const { stdout } = await execa(
      "gh",
      [
        "repo",
        "view",
        "--json",
        "defaultBranchRef",
        "--jq",
        ".defaultBranchRef.name",
      ],
      { cwd: repoRoot },
    );
    const branch = stdout.trim();
    if (branch) return branch;
  } catch {
    // ignore
  }

  // Fallback: origin/HEAD symbolic-ref
  try {
    const { stdout } = await execa(
      "git",
      ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
      { cwd: repoRoot },
    );
    const ref = stdout.trim();
    const match = ref.match(/^origin\/(.+)$/);
    if (match?.[1]) return match[1];
  } catch {
    // ignore
  }

  return "main";
}

async function ensureGitignoreEntry(
  repoRoot: string,
  entry: string,
): Promise<void> {
  const gitignorePath = join(repoRoot, ".gitignore");
  const content = existsSync(gitignorePath)
    ? readFileSync(gitignorePath, "utf-8")
    : "";

  const hasEntry = content
    .split("\n")
    .map((l) => l.trim())
    .includes(entry);

  if (hasEntry) return;

  const next = (content.trimEnd() + "\n" + entry + "\n").replace(/^\n/, "");
  writeFileSync(gitignorePath, next);
  console.log(`Updated ${gitignorePath} (added ${entry})`);
}
