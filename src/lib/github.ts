import { execa } from "execa";

export async function createDraftPR(
  repoRoot: string,
  branch: string,
  title: string,
  body: string
): Promise<number> {
  const { stdout } = await execa(
    "gh",
    [
      "pr",
      "create",
      "--draft",
      "--title",
      title,
      "--body",
      body,
      "--head",
      branch,
    ],
    { cwd: repoRoot }
  );

  // Extract PR number from URL
  const match = stdout.match(/\/pull\/(\d+)/);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }

  throw new Error(`Failed to parse PR number from: ${stdout}`);
}

export async function updatePRBody(
  repoRoot: string,
  prNumber: number,
  body: string
): Promise<void> {
  await execa("gh", ["pr", "edit", String(prNumber), "--body", body], {
    cwd: repoRoot,
  });
}

export async function markPRReady(
  repoRoot: string,
  prNumber: number
): Promise<void> {
  await execa("gh", ["pr", "ready", String(prNumber)], { cwd: repoRoot });
}

export async function getPRState(
  repoRoot: string,
  prNumber: number
): Promise<"open" | "merged" | "closed"> {
  const { stdout } = await execa(
    "gh",
    ["pr", "view", String(prNumber), "--json", "state", "-q", ".state"],
    { cwd: repoRoot }
  );

  const state = stdout.trim().toLowerCase();
  if (state === "merged") return "merged";
  if (state === "closed") return "closed";
  return "open";
}
