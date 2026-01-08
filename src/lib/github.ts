import { execa } from "execa";

export async function createDraftPR(
  repoRoot: string,
  branch: string,
  baseBranch: string,
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
      "--base",
      baseBranch,
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

// PR Feedback Types

export interface GitHubUser {
  id: number;
  login: string;
}

export interface PRFeedback {
  id: number;
  type: "issue_comment" | "review" | "review_comment";
  author: string;
  body: string;
  path?: string;
  line?: number;
  reviewState?: string;
  createdAt: string;
  /** For review_comment: ID of the parent comment if this is a reply */
  inReplyToId?: number;
}

export interface FeedbackCursors {
  lastIssueCommentId?: number;
  lastReviewId?: number;
  lastReviewCommentId?: number;
}

const BOT_MARKER = "🤖";

// Get authenticated GitHub user

let cachedUser: GitHubUser | null = null;

export async function getCurrentGitHubUser(): Promise<GitHubUser> {
  if (cachedUser) return cachedUser;

  const { stdout } = await execa("gh", [
    "api",
    "user",
    "--jq",
    "{id: .id, login: .login}",
  ]);
  cachedUser = JSON.parse(stdout);
  return cachedUser!;
}

// Fetch PR comments (issue comments)

export async function getPRComments(
  repoRoot: string,
  prNumber: number
): Promise<PRFeedback[]> {
  const { stdout } = await execa(
    "gh",
    [
      "api",
      `repos/{owner}/{repo}/issues/${prNumber}/comments`,
      "--jq",
      ".[] | {id: .id, author: .user.login, body: .body, createdAt: .created_at}",
    ],
    { cwd: repoRoot }
  );

  if (!stdout.trim()) return [];

  return stdout
    .trim()
    .split("\n")
    .map((line) => {
      const obj = JSON.parse(line);
      return {
        id: obj.id,
        type: "issue_comment" as const,
        author: obj.author,
        body: obj.body,
        createdAt: obj.createdAt,
      };
    });
}

// Fetch PR reviews

export async function getPRReviews(
  repoRoot: string,
  prNumber: number
): Promise<PRFeedback[]> {
  const { stdout } = await execa(
    "gh",
    [
      "api",
      `repos/{owner}/{repo}/pulls/${prNumber}/reviews`,
      "--jq",
      ".[] | {id: .id, author: .user.login, body: .body, state: .state, createdAt: .submitted_at}",
    ],
    { cwd: repoRoot }
  );

  if (!stdout.trim()) return [];

  return stdout
    .trim()
    .split("\n")
    .map((line) => {
      const obj = JSON.parse(line);
      return {
        id: obj.id,
        type: "review" as const,
        author: obj.author,
        body: obj.body || "",
        reviewState: obj.state,
        createdAt: obj.createdAt,
      };
    });
}

// Fetch PR review comments (inline comments)

export async function getPRReviewComments(
  repoRoot: string,
  prNumber: number
): Promise<PRFeedback[]> {
  const { stdout } = await execa(
    "gh",
    [
      "api",
      `repos/{owner}/{repo}/pulls/${prNumber}/comments`,
      "--jq",
      ".[] | {id: .id, author: .user.login, body: .body, path: .path, line: .line, createdAt: .created_at, inReplyToId: .in_reply_to_id}",
    ],
    { cwd: repoRoot }
  );

  if (!stdout.trim()) return [];

  return stdout
    .trim()
    .split("\n")
    .map((line) => {
      const obj = JSON.parse(line);
      return {
        id: obj.id,
        type: "review_comment" as const,
        author: obj.author,
        body: obj.body,
        path: obj.path,
        line: obj.line,
        createdAt: obj.createdAt,
        inReplyToId: obj.inReplyToId || undefined,
      };
    });
}

// Post PR comment with bot marker

export async function postPRComment(
  repoRoot: string,
  prNumber: number,
  body: string
): Promise<void> {
  const markedBody = `${BOT_MARKER}\n${body}`;
  await execa("gh", ["pr", "comment", String(prNumber), "--body", markedBody], {
    cwd: repoRoot,
  });
}

// Bot detection

export function isBotFeedback(feedback: PRFeedback, _botLogin: string): boolean {
  // Check if message starts with bot emoji marker
  return feedback.body.trimStart().startsWith(BOT_MARKER);
}

// Filter new feedback based on cursors

export function filterNewFeedback(
  feedback: PRFeedback[],
  cursors: FeedbackCursors,
  botLogin: string
): PRFeedback[] {
  return feedback.filter((f) => {
    // Ignore bot feedback
    if (isBotFeedback(f, botLogin)) return false;

    // Filter by cursor based on type
    if (f.type === "issue_comment") {
      return !cursors.lastIssueCommentId || f.id > cursors.lastIssueCommentId;
    }
    if (f.type === "review") {
      return !cursors.lastReviewId || f.id > cursors.lastReviewId;
    }
    if (f.type === "review_comment") {
      return !cursors.lastReviewCommentId || f.id > cursors.lastReviewCommentId;
    }
    return true;
  });
}

// Get max IDs from feedback for cursor update

export function getMaxFeedbackIds(feedback: PRFeedback[]): FeedbackCursors {
  const result: FeedbackCursors = {};

  for (const f of feedback) {
    if (f.type === "issue_comment") {
      result.lastIssueCommentId = Math.max(
        result.lastIssueCommentId ?? 0,
        f.id
      );
    } else if (f.type === "review") {
      result.lastReviewId = Math.max(result.lastReviewId ?? 0, f.id);
    } else if (f.type === "review_comment") {
      result.lastReviewCommentId = Math.max(
        result.lastReviewCommentId ?? 0,
        f.id
      );
    }
  }

  return result;
}

// Submit PR Review with comments

export interface ReviewComment {
  path: string;
  line: number;
  body: string;
}

export interface ReviewSubmission {
  verdict: "approve" | "request_changes" | "comment";
  summary: string;
  comments: ReviewComment[];
}

/**
 * Submit a PR review with inline comments.
 * All comments are posted atomically as a single review.
 */
export async function submitPRReview(
  repoRoot: string,
  prNumber: number,
  review: ReviewSubmission
): Promise<void> {
  // Map verdict to GitHub event name
  const eventMap = {
    approve: "APPROVE",
    request_changes: "REQUEST_CHANGES",
    comment: "COMMENT",
  };
  const event = eventMap[review.verdict];

  // Build the review payload
  // GitHub API: POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews
  const payload = {
    body: `${BOT_MARKER}\n${review.summary}`,
    event,
    comments: review.comments.map((c) => ({
      path: c.path,
      line: c.line,
      body: c.body,
    })),
  };

  // Use gh api to submit the review
  await execa(
    "gh",
    [
      "api",
      `repos/{owner}/{repo}/pulls/${prNumber}/reviews`,
      "--method",
      "POST",
      "--input",
      "-",
    ],
    {
      cwd: repoRoot,
      input: JSON.stringify(payload),
    }
  );
}
