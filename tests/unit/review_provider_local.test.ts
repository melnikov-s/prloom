/**
 * Local Review Provider Unit Tests
 *
 * Tests the local review provider parsing, dedupe, and checkbox updates.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  parseReviewMd,
  computeItemHash,
  localProvider,
  updateReviewMdCheckbox,
} from "../../src/lib/review/local.js";
import type {
  ReviewProviderContext,
  LocalReviewItem,
} from "../../src/lib/review/types.js";

// =============================================================================
// Test Helpers
// =============================================================================

function createTempDir(): string {
  const dir = join(tmpdir(), `review-provider-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

const mockLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

// =============================================================================
// parseReviewMd Tests
// =============================================================================

describe("parseReviewMd", () => {
  test("parses unchecked items in ## ready section", () => {
    const content = `# Code Review

## staged

- Draft comment
  file: src/utils.ts
  side: right
  line: 15

## ready

- [ ] Add input validation
  file: src/form.ts
  side: right
  line: 42

- [ ] Fix typo in error message
  file: src/api.ts
  side: left
  line: 88
`;

    const items = parseReviewMd(content);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      text: "Add input validation",
      file: "src/form.ts",
      line: 42,
      side: "right",
      checked: false,
    });
    expect(items[1]).toEqual({
      text: "Fix typo in error message",
      file: "src/api.ts",
      line: 88,
      side: "left",
      checked: false,
    });
  });

  test("ignores checked items [x]", () => {
    const content = `## ready

- [ ] Unchecked item
  file: src/a.ts
  line: 10

- [x] Already done
  file: src/b.ts
  line: 20
`;

    const items = parseReviewMd(content);

    expect(items).toHaveLength(1);
    expect(items[0]!.text).toBe("Unchecked item");
  });

  test("ignores items outside ## ready section", () => {
    const content = `## staged

- [ ] Draft item
  file: src/draft.ts
  line: 5

## ready

- [ ] Ready item
  file: src/ready.ts
  line: 10

## done

- [x] Completed item
  file: src/done.ts
  line: 15
`;

    const items = parseReviewMd(content);

    expect(items).toHaveLength(1);
    expect(items[0]!.text).toBe("Ready item");
  });

  test("defaults side to 'right' when missing", () => {
    const content = `## ready

- [ ] No side specified
  file: src/test.ts
  line: 42
`;

    const items = parseReviewMd(content);

    expect(items).toHaveLength(1);
    expect(items[0]!.side).toBe("right");
  });

  test("skips items without required file metadata", () => {
    const content = `## ready

- [ ] Missing file
  line: 42

- [ ] Has file
  file: src/valid.ts
  line: 10
`;

    const items = parseReviewMd(content);

    expect(items).toHaveLength(1);
    expect(items[0]!.text).toBe("Has file");
  });

  test("skips items without required line metadata", () => {
    const content = `## ready

- [ ] Missing line
  file: src/invalid.ts

- [ ] Has line
  file: src/valid.ts
  line: 10
`;

    const items = parseReviewMd(content);

    expect(items).toHaveLength(1);
    expect(items[0]!.text).toBe("Has line");
  });

  test("handles case-insensitive heading match", () => {
    const content = `## READY

- [ ] Uppercase heading
  file: src/test.ts
  line: 1
`;

    const items = parseReviewMd(content);

    expect(items).toHaveLength(1);
    expect(items[0]!.text).toBe("Uppercase heading");
  });

  test("returns empty array for missing ## ready section", () => {
    const content = `## staged

- [ ] Draft item
  file: src/draft.ts
  line: 5
`;

    const items = parseReviewMd(content);

    expect(items).toHaveLength(0);
  });

  test("returns empty array for empty content", () => {
    const items = parseReviewMd("");

    expect(items).toHaveLength(0);
  });

  test("handles multiline item text", () => {
    const content = `## ready

- [ ] This is a longer comment
  that spans multiple lines
  file: src/test.ts
  line: 10
`;

    const items = parseReviewMd(content);

    expect(items).toHaveLength(1);
    expect(items[0]!.text).toBe("This is a longer comment that spans multiple lines");
  });
});

// =============================================================================
// computeItemHash Tests
// =============================================================================

describe("computeItemHash", () => {
  test("generates stable hash for same input", () => {
    const item: LocalReviewItem = {
      text: "Add validation",
      file: "src/form.ts",
      line: 42,
      side: "right",
      checked: false,
    };

    const hash1 = computeItemHash(item);
    const hash2 = computeItemHash(item);

    expect(hash1).toBe(hash2);
  });

  test("generates different hash for different text", () => {
    const item1: LocalReviewItem = {
      text: "Add validation",
      file: "src/form.ts",
      line: 42,
      side: "right",
      checked: false,
    };
    const item2: LocalReviewItem = {
      ...item1,
      text: "Remove validation",
    };

    expect(computeItemHash(item1)).not.toBe(computeItemHash(item2));
  });

  test("generates different hash for different file", () => {
    const item1: LocalReviewItem = {
      text: "Add validation",
      file: "src/form.ts",
      line: 42,
      side: "right",
      checked: false,
    };
    const item2: LocalReviewItem = {
      ...item1,
      file: "src/other.ts",
    };

    expect(computeItemHash(item1)).not.toBe(computeItemHash(item2));
  });

  test("generates different hash for different line", () => {
    const item1: LocalReviewItem = {
      text: "Add validation",
      file: "src/form.ts",
      line: 42,
      side: "right",
      checked: false,
    };
    const item2: LocalReviewItem = {
      ...item1,
      line: 100,
    };

    expect(computeItemHash(item1)).not.toBe(computeItemHash(item2));
  });

  test("generates different hash for different side", () => {
    const item1: LocalReviewItem = {
      text: "Add validation",
      file: "src/form.ts",
      line: 42,
      side: "right",
      checked: false,
    };
    const item2: LocalReviewItem = {
      ...item1,
      side: "left",
    };

    expect(computeItemHash(item1)).not.toBe(computeItemHash(item2));
  });
});

// =============================================================================
// localProvider.poll Tests
// =============================================================================

describe("localProvider.poll", () => {
  let tempDir: string;
  let worktree: string;

  beforeEach(() => {
    tempDir = createTempDir();
    worktree = join(tempDir, "worktree");
    mkdirSync(join(worktree, "prloom", ".local"), { recursive: true });
  });

  afterEach(() => {
    cleanupDir(tempDir);
  });

  test("returns items from review.md", async () => {
    const reviewContent = `## ready

- [ ] Add validation
  file: src/form.ts
  line: 42
`;
    writeFileSync(join(worktree, "prloom", ".local", "review.md"), reviewContent);

    const ctx: ReviewProviderContext = {
      repoRoot: tempDir,
      worktree,
      planId: "test-plan",
      log: mockLog,
    };

    const result = await localProvider.poll(ctx, undefined);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.body).toBe("Add validation");
    expect(result.items[0]!.path).toBe("src/form.ts");
    expect(result.items[0]!.line).toBe(42);
    expect(result.items[0]!.side).toBe("right");
  });

  test("deduplicates items using hash state", async () => {
    const reviewContent = `## ready

- [ ] Add validation
  file: src/form.ts
  line: 42
`;
    writeFileSync(join(worktree, "prloom", ".local", "review.md"), reviewContent);

    const ctx: ReviewProviderContext = {
      repoRoot: tempDir,
      worktree,
      planId: "test-plan",
      log: mockLog,
    };

    // First poll - should return the item
    const result1 = await localProvider.poll(ctx, undefined);
    expect(result1.items).toHaveLength(1);

    // Second poll with state from first - should return empty
    const result2 = await localProvider.poll(ctx, result1.state);
    expect(result2.items).toHaveLength(0);
  });

  test("removes hash when item is checked off", async () => {
    const ctx: ReviewProviderContext = {
      repoRoot: tempDir,
      worktree,
      planId: "test-plan",
      config: { pollIntervalMs: 0 }, // Disable poll interval for test
      log: mockLog,
    };

    // Initial content with unchecked item
    const reviewContent1 = `## ready

- [ ] Add validation
  file: src/form.ts
  line: 42
`;
    writeFileSync(join(worktree, "prloom", ".local", "review.md"), reviewContent1);

    const result1 = await localProvider.poll(ctx, undefined);
    expect(result1.items).toHaveLength(1);
    expect(result1.state.processedHashes).toHaveLength(1);

    // Mark item as checked
    const reviewContent2 = `## ready

- [x] Add validation
  file: src/form.ts
  line: 42
`;
    writeFileSync(join(worktree, "prloom", ".local", "review.md"), reviewContent2);

    // Poll again - hash should be removed from state
    const result2 = await localProvider.poll(ctx, result1.state);
    expect(result2.items).toHaveLength(0);
    expect(result2.state.processedHashes).toHaveLength(0);
  });

  test("returns empty when review.md does not exist", async () => {
    const ctx: ReviewProviderContext = {
      repoRoot: tempDir,
      worktree,
      planId: "test-plan",
      log: mockLog,
    };

    const result = await localProvider.poll(ctx, undefined);

    expect(result.items).toHaveLength(0);
    expect(result.state.processedHashes).toEqual([]);
  });

  test("respects poll interval from config", async () => {
    const reviewContent = `## ready

- [ ] Add validation
  file: src/form.ts
  line: 42
`;
    writeFileSync(join(worktree, "prloom", ".local", "review.md"), reviewContent);

    const ctx: ReviewProviderContext = {
      repoRoot: tempDir,
      worktree,
      planId: "test-plan",
      config: { pollIntervalMs: 60000 },
      log: mockLog,
    };

    // First poll
    const result1 = await localProvider.poll(ctx, undefined);
    expect(result1.items).toHaveLength(1);

    // Second poll immediately (within poll interval) should skip
    const result2 = await localProvider.poll(ctx, result1.state);
    expect(result2.items).toHaveLength(0);
    expect(result2.state.lastPollTime).toBe(result1.state.lastPollTime);
  });

  test("generates unique ID for each item", async () => {
    const reviewContent = `## ready

- [ ] First item
  file: src/a.ts
  line: 10

- [ ] Second item
  file: src/b.ts
  line: 20
`;
    writeFileSync(join(worktree, "prloom", ".local", "review.md"), reviewContent);

    const ctx: ReviewProviderContext = {
      repoRoot: tempDir,
      worktree,
      planId: "test-plan",
      log: mockLog,
    };

    const result = await localProvider.poll(ctx, undefined);

    expect(result.items).toHaveLength(2);
    expect(result.items[0]!.id).not.toBe(result.items[1]!.id);
  });
});

// =============================================================================
// updateReviewMdCheckbox Tests
// =============================================================================

describe("updateReviewMdCheckbox", () => {
  let tempDir: string;
  let worktree: string;

  beforeEach(() => {
    tempDir = createTempDir();
    worktree = join(tempDir, "worktree");
    mkdirSync(join(worktree, "prloom", ".local"), { recursive: true });
  });

  afterEach(() => {
    cleanupDir(tempDir);
  });

  test("marks matching item as checked", () => {
    const content = `## ready

- [ ] Add validation
  file: src/form.ts
  line: 42
`;
    const reviewPath = join(worktree, "prloom", ".local", "review.md");
    writeFileSync(reviewPath, content);

    const success = updateReviewMdCheckbox(worktree, {
      text: "Add validation",
      file: "src/form.ts",
      line: 42,
      side: "right",
    });

    expect(success).toBe(true);

    const updated = readFileSync(reviewPath, "utf-8");
    expect(updated).toContain("- [x] Add validation");
    expect(updated).not.toContain("- [ ] Add validation");
  });

  test("matches by text, file, line, and side", () => {
    const content = `## ready

- [ ] Same text
  file: src/a.ts
  line: 10
  side: left

- [ ] Same text
  file: src/a.ts
  line: 10
  side: right
`;
    const reviewPath = join(worktree, "prloom", ".local", "review.md");
    writeFileSync(reviewPath, content);

    const success = updateReviewMdCheckbox(worktree, {
      text: "Same text",
      file: "src/a.ts",
      line: 10,
      side: "right",
    });

    expect(success).toBe(true);

    const updated = readFileSync(reviewPath, "utf-8");
    // First item (left side) should remain unchecked
    expect(updated).toContain("- [ ] Same text\n  file: src/a.ts\n  line: 10\n  side: left");
    // Second item (right side) should be checked
    expect(updated).toContain("- [x] Same text\n  file: src/a.ts\n  line: 10\n  side: right");
  });

  test("returns false when no match found", () => {
    const content = `## ready

- [ ] Existing item
  file: src/exists.ts
  line: 10
`;
    writeFileSync(join(worktree, "prloom", ".local", "review.md"), content);

    const success = updateReviewMdCheckbox(worktree, {
      text: "Non-existent item",
      file: "src/other.ts",
      line: 99,
      side: "right",
    });

    expect(success).toBe(false);
  });

  test("returns false when review.md does not exist", () => {
    const success = updateReviewMdCheckbox(worktree, {
      text: "Any item",
      file: "src/test.ts",
      line: 1,
      side: "right",
    });

    expect(success).toBe(false);
  });

  test("preserves other content in review.md", () => {
    const content = `# Code Review

## staged

- Draft comment
  file: src/draft.ts
  line: 5

## ready

- [ ] Item to check
  file: src/form.ts
  line: 42

- [ ] Other item
  file: src/other.ts
  line: 10

## notes

Some additional notes here.
`;
    const reviewPath = join(worktree, "prloom", ".local", "review.md");
    writeFileSync(reviewPath, content);

    updateReviewMdCheckbox(worktree, {
      text: "Item to check",
      file: "src/form.ts",
      line: 42,
      side: "right",
    });

    const updated = readFileSync(reviewPath, "utf-8");
    expect(updated).toContain("# Code Review");
    expect(updated).toContain("## staged");
    expect(updated).toContain("- Draft comment");
    expect(updated).toContain("- [x] Item to check");
    expect(updated).toContain("- [ ] Other item");
    expect(updated).toContain("## notes");
    expect(updated).toContain("Some additional notes here.");
  });
});

// =============================================================================
// localProvider metadata Tests
// =============================================================================

describe("localProvider metadata", () => {
  test("has correct name", () => {
    expect(localProvider.name).toBe("local");
  });

  test("has poll method", () => {
    expect(typeof localProvider.poll).toBe("function");
  });

  test("does not have respond method (local provider doesn't post replies)", () => {
    expect(localProvider.respond).toBeUndefined();
  });
});
