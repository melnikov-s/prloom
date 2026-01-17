/**
 * Review Provider Resolution Loop Tests
 *
 * Tests the resolution loop that updates review.md checkboxes
 * when TODOs are completed.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { updateReviewMdCheckbox } from "../../src/lib/review/local.js";
import type { CheckboxMatchCriteria } from "../../src/lib/review/local.js";

// =============================================================================
// Test Helpers
// =============================================================================

function createTempDir(): string {
  const dir = join(
    tmpdir(),
    `review-resolution-test-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

// =============================================================================
// Resolution Loop Tests
// =============================================================================

describe("resolution loop - updateReviewMdCheckbox", () => {
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

  test("marks checkbox when TODO completes with matching context", () => {
    const content = `## ready

- [ ] Add input validation
  file: src/form.ts
  line: 42
  side: right

- [ ] Fix error handling
  file: src/api.ts
  line: 100
  side: right
`;
    const reviewPath = join(worktree, "prloom", ".local", "review.md");
    writeFileSync(reviewPath, content);

    // Simulate TODO completion with review context
    const criteria: CheckboxMatchCriteria = {
      text: "Add input validation",
      file: "src/form.ts",
      line: 42,
      side: "right",
    };

    const updated = updateReviewMdCheckbox(worktree, criteria);
    expect(updated).toBe(true);

    const newContent = readFileSync(reviewPath, "utf-8");
    expect(newContent).toContain("- [x] Add input validation");
    expect(newContent).toContain("- [ ] Fix error handling"); // Other item unchanged
  });

  test("does not update if text doesn't match", () => {
    const content = `## ready

- [ ] Original text
  file: src/form.ts
  line: 42
  side: right
`;
    const reviewPath = join(worktree, "prloom", ".local", "review.md");
    writeFileSync(reviewPath, content);

    const criteria: CheckboxMatchCriteria = {
      text: "Different text",
      file: "src/form.ts",
      line: 42,
      side: "right",
    };

    const updated = updateReviewMdCheckbox(worktree, criteria);
    expect(updated).toBe(false);

    const newContent = readFileSync(reviewPath, "utf-8");
    expect(newContent).toContain("- [ ] Original text");
  });

  test("does not update if file doesn't match", () => {
    const content = `## ready

- [ ] Fix bug
  file: src/original.ts
  line: 42
  side: right
`;
    const reviewPath = join(worktree, "prloom", ".local", "review.md");
    writeFileSync(reviewPath, content);

    const criteria: CheckboxMatchCriteria = {
      text: "Fix bug",
      file: "src/different.ts",
      line: 42,
      side: "right",
    };

    const updated = updateReviewMdCheckbox(worktree, criteria);
    expect(updated).toBe(false);
  });

  test("does not update if line doesn't match", () => {
    const content = `## ready

- [ ] Fix bug
  file: src/file.ts
  line: 42
  side: right
`;
    const reviewPath = join(worktree, "prloom", ".local", "review.md");
    writeFileSync(reviewPath, content);

    const criteria: CheckboxMatchCriteria = {
      text: "Fix bug",
      file: "src/file.ts",
      line: 99,
      side: "right",
    };

    const updated = updateReviewMdCheckbox(worktree, criteria);
    expect(updated).toBe(false);
  });

  test("does not update if side doesn't match", () => {
    const content = `## ready

- [ ] Fix bug
  file: src/file.ts
  line: 42
  side: left
`;
    const reviewPath = join(worktree, "prloom", ".local", "review.md");
    writeFileSync(reviewPath, content);

    const criteria: CheckboxMatchCriteria = {
      text: "Fix bug",
      file: "src/file.ts",
      line: 42,
      side: "right",
    };

    const updated = updateReviewMdCheckbox(worktree, criteria);
    expect(updated).toBe(false);
  });

  test("handles missing review.md gracefully", () => {
    const criteria: CheckboxMatchCriteria = {
      text: "Some task",
      file: "src/file.ts",
      line: 10,
      side: "right",
    };

    const updated = updateReviewMdCheckbox(worktree, criteria);
    expect(updated).toBe(false);
  });

  test("only updates items in ## ready section", () => {
    const content = `## staged

- [ ] Draft item matching criteria
  file: src/form.ts
  line: 42
  side: right

## ready

- [ ] Ready item
  file: src/other.ts
  line: 10
  side: right
`;
    const reviewPath = join(worktree, "prloom", ".local", "review.md");
    writeFileSync(reviewPath, content);

    const criteria: CheckboxMatchCriteria = {
      text: "Draft item matching criteria",
      file: "src/form.ts",
      line: 42,
      side: "right",
    };

    // Should NOT update because it's in ## staged, not ## ready
    const updated = updateReviewMdCheckbox(worktree, criteria);
    expect(updated).toBe(false);

    const newContent = readFileSync(reviewPath, "utf-8");
    expect(newContent).toContain("- [ ] Draft item matching criteria");
  });
});

// =============================================================================
// TODO Context Parsing Tests
// =============================================================================

describe("TODO context for resolution", () => {
  test("context format includes required fields for resolution", () => {
    // Per RFC, TODOs created from review feedback should include:
    // - review_provider: local
    // - file: src/form.ts
    // - line: 42
    // - side: right

    const exampleContext = `review_provider: local
file: src/form.ts
line: 42
side: right
originalText: Add input validation`;

    // Parse context (this simulates what parseReviewContext would do)
    const lines = exampleContext.split("\n");
    const parsed: Record<string, string | number> = {};
    for (const line of lines) {
      const match = line.match(/^([\w]+):\s*(.+)/);
      if (match) {
        parsed[match[1]!] =
          match[1] === "line" ? parseInt(match[2]!, 10) : match[2]!;
      }
    }

    expect(parsed.review_provider).toBe("local");
    expect(parsed.file).toBe("src/form.ts");
    expect(parsed.line).toBe(42);
    expect(parsed.side).toBe("right");
    expect(parsed.originalText).toBe("Add input validation");
  });
});
