import { execa } from "execa";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline";
import { loadConfig } from "../lib/config.js";

const SWARM_START_TAG = "<!-- SWARM_INSTRUCTIONS_START -->";
const SWARM_END_TAG = "<!-- SWARM_INSTRUCTIONS_END -->";

export interface InitOptions {
  yes?: boolean;
  force?: boolean;
}

export async function runInit(
  cwd: string,
  opts: InitOptions = {}
): Promise<void> {
  const repoRoot = cwd;

  await ensureGhInstalled();
  await ensureGhAuthed();
  await ensureGhRepoResolvable(repoRoot);

  const defaultBranch = await detectDefaultBranch(repoRoot);

  // Write config if missing (or if force)
  const configPath = join(repoRoot, "prloom.config.json");
  if (!existsSync(configPath) || opts.force) {
    // Load existing (if any) so we preserve agent choices when force is used
    const existing = loadConfig(repoRoot);
    const config = {
      agents: existing.agents,
      worktrees_dir: existing.worktrees_dir,
      poll_interval_ms: existing.poll_interval_ms,
      base_branch: defaultBranch,
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    console.log(`Wrote ${configPath}`);
  } else {
    console.log(`Found existing ${configPath} (leaving unchanged)`);
  }

  // Ensure .prloom/ runtime directories exist
  const prloomDir = join(repoRoot, ".prloom");
  const inboxDir = join(prloomDir, "inbox");
  const plansDir = join(prloomDir, "plans");

  mkdirSync(inboxDir, { recursive: true });
  mkdirSync(plansDir, { recursive: true });

  // Ensure gitignore
  await ensureGitignoreEntry(repoRoot, ".prloom/");

  console.log("✅ prloom initialized");
  console.log(`Base branch: ${defaultBranch}`);

  // Prompt for IDE instruction files (unless --yes skips prompts)
  if (!opts.yes) {
    await promptIdeInstructionFiles(repoRoot);
  }

  console.log("");
  console.log("Next: run `prloom new <id>` then `prloom start`");
}

async function promptIdeInstructionFiles(repoRoot: string): Promise<void> {
  const agentTemplate = loadAgentTemplate();
  if (!agentTemplate) {
    return;
  }

  console.log("");

  const wantCursor = await promptYesNo(
    "Append prloom instructions to CURSOR.md?"
  );
  if (wantCursor) {
    appendSwarmInstructions(repoRoot, "CURSOR.md", agentTemplate);
  }

  const wantAntigravity = await promptYesNo(
    "Append prloom instructions to ANTIGRAVITY.md?"
  );
  if (wantAntigravity) {
    appendSwarmInstructions(repoRoot, "ANTIGRAVITY.md", agentTemplate);
  }
}

function loadAgentTemplate(): string | null {
  // Find _agent.md relative to the package root
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    // From dist/cli/init.js -> package root is ../../
    const packageRoot = join(__dirname, "..", "..");
    const templatePath = join(packageRoot, "manual_agent.md");

    if (existsSync(templatePath)) {
      return readFileSync(templatePath, "utf-8");
    }

    // Also try from repo root during development
    const devPath = join(__dirname, "..", "..", "..", "manual_agent.md");
    if (existsSync(devPath)) {
      return readFileSync(devPath, "utf-8");
    }
  } catch {
    // ignore
  }
  return null;
}

function appendSwarmInstructions(
  repoRoot: string,
  filename: string,
  template: string
): void {
  const filePath = join(repoRoot, filename);
  const wrappedContent = `${SWARM_START_TAG}\n${template}\n${SWARM_END_TAG}`;

  if (!existsSync(filePath)) {
    // Create new file with wrapped content
    writeFileSync(filePath, wrappedContent + "\n");
    console.log(`Created ${filename} with prloom instructions`);
    return;
  }

  const existing = readFileSync(filePath, "utf-8");

  // Check if tags already exist - replace content between them
  const tagPattern = new RegExp(
    `${escapeRegex(SWARM_START_TAG)}[\\s\\S]*?${escapeRegex(SWARM_END_TAG)}`,
    "g"
  );

  if (tagPattern.test(existing)) {
    const updated = existing.replace(tagPattern, wrappedContent);
    writeFileSync(filePath, updated);
    console.log(`Updated prloom instructions in ${filename}`);
  } else {
    // Append to end of file
    const updated = existing.trimEnd() + "\n\n" + wrappedContent + "\n";
    writeFileSync(filePath, updated);
    console.log(`Appended prloom instructions to ${filename}`);
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function promptYesNo(question: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question} (y/n) `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().startsWith("y"));
    });
  });
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
      { cwd: repoRoot, stdio: "ignore" }
    );
  } catch {
    console.error(
      "Unable to resolve the GitHub repository from this directory."
    );
    console.error(
      "Make sure this repo has an `origin` remote pointing to GitHub."
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
      { cwd: repoRoot }
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
      { cwd: repoRoot }
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
  entry: string
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
