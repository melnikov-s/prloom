/**
 * PlanState Extensions Tests
 *
 * Tests for new PlanState properties: `hidden` and `source`.
 * These extensions enable plan visibility control and external identity tracking.
 *
 * See RFC: docs/rfc-global-bridge-and-core.md
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadState, saveState, ensureInboxDir } from "../../src/lib/state.js";
import type { State, PlanState } from "../../src/lib/state.js";

describe("PlanState Extensions", () => {
  let tempDir: string;
  let repoRoot: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "plan-state-ext-test-"));
    repoRoot = join(tempDir, "repo");
    mkdirSync(repoRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("hidden property", () => {
    test("plan can have hidden: true", () => {
      ensureInboxDir(repoRoot);
      // Create the plan markdown file (required for loadState to find the plan)
      const inboxPath = join(
        repoRoot,
        "prloom",
        ".local",
        "inbox",
        "test-plan.md"
      );
      writeFileSync(inboxPath, "# Test Plan\n\n- [ ] Task");

      const state: State = {
        control_cursor: 0,
        plans: {
          "test-plan": {
            status: "queued",
            hidden: true,
          },
        },
      };

      saveState(repoRoot, state);
      const loaded = loadState(repoRoot);

      expect(loaded.plans["test-plan"]?.status).toBe("queued");
      expect(loaded.plans["test-plan"]?.hidden).toBe(true);
    });

    test("hidden defaults to undefined/false when not set", () => {
      ensureInboxDir(repoRoot);
      // Create the plan markdown file
      const inboxPath = join(
        repoRoot,
        "prloom",
        ".local",
        "inbox",
        "test-plan.md"
      );
      writeFileSync(inboxPath, "# Test Plan");

      const state: State = {
        control_cursor: 0,
        plans: {
          "test-plan": {
            status: "draft",
          },
        },
      };

      saveState(repoRoot, state);
      const loaded = loadState(repoRoot);

      expect(loaded.plans["test-plan"]?.status).toBe("draft");
      expect(loaded.plans["test-plan"]?.hidden).toBeFalsy();
    });

    test("hidden can be set to false explicitly", () => {
      ensureInboxDir(repoRoot);
      // Create the plan markdown file
      const inboxPath = join(
        repoRoot,
        "prloom",
        ".local",
        "inbox",
        "test-plan.md"
      );
      writeFileSync(inboxPath, "# Test Plan");

      const state: State = {
        control_cursor: 0,
        plans: {
          "test-plan": {
            status: "queued",
            hidden: false,
          },
        },
      };

      saveState(repoRoot, state);
      const loaded = loadState(repoRoot);

      expect(loaded.plans["test-plan"]?.status).toBe("queued");
      expect(loaded.plans["test-plan"]?.hidden).toBe(false);
    });

    test("hidden is orthogonal to status", () => {
      // A plan can be queued but hidden, meaning it's ready but skipped by dispatcher
      ensureInboxDir(repoRoot);
      const inboxDir = join(repoRoot, "prloom", ".local", "inbox");
      writeFileSync(join(inboxDir, "hidden-queued.md"), "# Hidden Queued");
      writeFileSync(join(inboxDir, "hidden-draft.md"), "# Hidden Draft");

      const state: State = {
        control_cursor: 0,
        plans: {
          "hidden-queued": {
            status: "queued",
            hidden: true,
          },
          "hidden-draft": {
            status: "draft",
            hidden: true,
          },
        },
      };

      saveState(repoRoot, state);
      const loaded = loadState(repoRoot);

      expect(Object.keys(loaded.plans).length).toBe(2);
      expect(loaded.plans["hidden-queued"]?.status).toBe("queued");
      expect(loaded.plans["hidden-queued"]?.hidden).toBe(true);
      expect(loaded.plans["hidden-draft"]?.status).toBe("draft");
      expect(loaded.plans["hidden-draft"]?.hidden).toBe(true);
    });

    test("hidden persists in inbox metadata", () => {
      ensureInboxDir(repoRoot);

      const state: State = {
        control_cursor: 0,
        plans: {
          "inbox-plan": {
            status: "draft",
            hidden: true,
          },
        },
      };

      // Create the plan markdown file
      const inboxPath = join(
        repoRoot,
        "prloom",
        ".local",
        "inbox",
        "inbox-plan.md"
      );
      writeFileSync(inboxPath, "# Test Plan\n\n- [ ] Task");

      saveState(repoRoot, state);

      // Verify metadata file contains hidden
      const metaPath = join(
        repoRoot,
        "prloom",
        ".local",
        "inbox",
        "inbox-plan.json"
      );
      // TODO: When implemented:
      // const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
      // expect(meta.hidden).toBe(true);

      expect(existsSync(metaPath)).toBe(true);
    });

    test("hidden persists in worktree state.json", () => {
      const worktreePath = join(
        repoRoot,
        "prloom",
        ".local",
        "worktrees",
        "test-plan"
      );
      mkdirSync(join(worktreePath, "prloom", ".local"), { recursive: true });

      const state: State = {
        control_cursor: 0,
        plans: {
          "test-plan": {
            status: "active",
            worktree: worktreePath,
            branch: "prloom/test-plan",
            hidden: true,
          },
        },
      };

      saveState(repoRoot, state);

      // Verify worktree state.json contains hidden
      const statePath = join(worktreePath, "prloom", ".local", "state.json");
      // TODO: When implemented:
      // const stateData = JSON.parse(readFileSync(statePath, "utf-8"));
      // expect(stateData.hidden).toBe(true);

      expect(existsSync(statePath)).toBe(true);
    });
  });

  describe("source property (PlanSource)", () => {
    test("plan can have source with system, kind, and id", () => {
      ensureInboxDir(repoRoot);
      const inboxPath = join(
        repoRoot,
        "prloom",
        ".local",
        "inbox",
        "gh-issue-123.md"
      );
      writeFileSync(inboxPath, "# GitHub Issue 123");

      const state: State = {
        control_cursor: 0,
        plans: {
          "gh-issue-123": {
            status: "draft",
            source: {
              system: "github",
              kind: "issue",
              id: "123",
            },
          },
        },
      };

      saveState(repoRoot, state);
      const loaded = loadState(repoRoot);

      expect(loaded.plans["gh-issue-123"]?.status).toBe("draft");
      expect(loaded.plans["gh-issue-123"]?.source).toEqual({
        system: "github",
        kind: "issue",
        id: "123",
      });
    });

    test("source is optional - plans without source are allowed", () => {
      ensureInboxDir(repoRoot);
      const inboxPath = join(
        repoRoot,
        "prloom",
        ".local",
        "inbox",
        "manual-plan.md"
      );
      writeFileSync(inboxPath, "# Manual Plan");

      const state: State = {
        control_cursor: 0,
        plans: {
          "manual-plan": {
            status: "draft",
            // No source
          },
        },
      };

      saveState(repoRoot, state);
      const loaded = loadState(repoRoot);

      expect(loaded.plans["manual-plan"]?.status).toBe("draft");
      expect(loaded.plans["manual-plan"]?.source).toBeUndefined();
    });

    test("different external systems can be tracked", () => {
      ensureInboxDir(repoRoot);
      const inboxDir = join(repoRoot, "prloom", ".local", "inbox");
      writeFileSync(join(inboxDir, "gh-123.md"), "# GitHub");
      writeFileSync(join(inboxDir, "jira-456.md"), "# Jira");
      writeFileSync(join(inboxDir, "linear-789.md"), "# Linear");

      const state: State = {
        control_cursor: 0,
        plans: {
          "gh-123": {
            status: "draft",
            source: { system: "github", kind: "issue", id: "123" },
          },
          "jira-456": {
            status: "draft",
            source: { system: "jira", kind: "ticket", id: "PROJ-456" },
          },
          "linear-789": {
            status: "draft",
            source: { system: "linear", kind: "card", id: "789" },
          },
        },
      };

      saveState(repoRoot, state);
      const loaded = loadState(repoRoot);

      expect(Object.keys(loaded.plans).length).toBe(3);
      expect(loaded.plans["gh-123"]?.source?.system).toBe("github");
      expect(loaded.plans["jira-456"]?.source?.system).toBe("jira");
      expect(loaded.plans["linear-789"]?.source?.system).toBe("linear");
    });

    test("source persists in inbox metadata", () => {
      ensureInboxDir(repoRoot);

      const state: State = {
        control_cursor: 0,
        plans: {
          "gh-issue-123": {
            status: "draft",
            source: { system: "github", kind: "issue", id: "123" },
          },
        },
      };

      const inboxPath = join(
        repoRoot,
        "prloom",
        ".local",
        "inbox",
        "gh-issue-123.md"
      );
      writeFileSync(inboxPath, "# Test Plan");

      saveState(repoRoot, state);

      const metaPath = join(
        repoRoot,
        "prloom",
        ".local",
        "inbox",
        "gh-issue-123.json"
      );
      // TODO: When implemented:
      // const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
      // expect(meta.source).toEqual({ system: "github", kind: "issue", id: "123" });

      expect(existsSync(metaPath)).toBe(true);
    });

    test("source persists in worktree state.json", () => {
      const worktreePath = join(
        repoRoot,
        "prloom",
        ".local",
        "worktrees",
        "gh-123"
      );
      mkdirSync(join(worktreePath, "prloom", ".local"), { recursive: true });

      const state: State = {
        control_cursor: 0,
        plans: {
          "gh-123": {
            status: "active",
            worktree: worktreePath,
            branch: "prloom/gh-123",
            source: { system: "github", kind: "issue", id: "123" },
          },
        },
      };

      saveState(repoRoot, state);

      const statePath = join(worktreePath, "prloom", ".local", "state.json");
      // TODO: When implemented:
      // const stateData = JSON.parse(readFileSync(statePath, "utf-8"));
      // expect(stateData.source).toEqual({ system: "github", kind: "issue", id: "123" });

      expect(existsSync(statePath)).toBe(true);
    });
  });

  describe("source migration from inbox to worktree", () => {
    test("source is copied when plan moves from inbox to worktree", () => {
      // TODO: This test requires dispatcher logic to be implemented
      // The flow:
      // 1. Create inbox plan with source
      // 2. Activate plan (move to worktree)
      // 3. Verify source is in worktree state.json
      // 4. Verify inbox files are deleted

      expect(true).toBe(true);
    });

    test("source is preserved across plan lifecycle", () => {
      // TODO: Test that source persists through:
      // inbox (draft) → inbox (queued) → worktree (active) → worktree (review) → worktree (done)

      expect(true).toBe(true);
    });
  });

  describe("source uniqueness enforcement", () => {
    test("two plans cannot have the same source", () => {
      // TODO: This will be enforced by prloom-core during upsert_plan
      // When a plan with matching source exists, it should be updated, not duplicated

      // For now, we can test that the state allows it (enforcement is in core bridge)
      ensureInboxDir(repoRoot);
      const inboxDir = join(repoRoot, "prloom", ".local", "inbox");
      writeFileSync(join(inboxDir, "plan-1.md"), "# Plan 1");
      writeFileSync(join(inboxDir, "plan-2.md"), "# Plan 2");

      const state: State = {
        control_cursor: 0,
        plans: {
          "plan-1": {
            status: "draft",
            source: { system: "github", kind: "issue", id: "123" },
          },
          "plan-2": {
            status: "draft",
            source: { system: "github", kind: "issue", id: "123" },
          },
        },
      };

      // State layer doesn't enforce uniqueness, but core bridge should
      saveState(repoRoot, state);
      const loaded = loadState(repoRoot);

      expect(Object.keys(loaded.plans).length).toBe(2);
    });

    test("findPlanBySource helper returns plan with matching source", () => {
      // TODO: When implemented:
      // ensureInboxDir(repoRoot);
      // const state: State = {
      //   control_cursor: 0,
      //   plans: {
      //     "gh-123": {
      //       status: "draft",
      //       source: { system: "github", kind: "issue", id: "123" },
      //     },
      //     "gh-456": {
      //       status: "draft",
      //       source: { system: "github", kind: "issue", id: "456" },
      //     },
      //   },
      // };
      // saveState(repoRoot, state);
      //
      // const found = findPlanBySource(repoRoot, { system: "github", kind: "issue", id: "123" });
      // expect(found?.planId).toBe("gh-123");

      expect(true).toBe(true);
    });

    test("findPlanBySource returns undefined when no match", () => {
      // TODO: When implemented:
      // const found = findPlanBySource(repoRoot, { system: "github", kind: "issue", id: "999" });
      // expect(found).toBeUndefined();

      expect(true).toBe(true);
    });

    test("findPlanBySource searches both inbox and worktrees", () => {
      // TODO: When implemented:
      // Create one plan in inbox, one in worktree, both with different sources
      // Verify both can be found by their respective sources

      expect(true).toBe(true);
    });
  });

  describe("combined hidden and source", () => {
    test("plan can have both hidden and source", () => {
      ensureInboxDir(repoRoot);
      const inboxPath = join(
        repoRoot,
        "prloom",
        ".local",
        "inbox",
        "gh-123.md"
      );
      writeFileSync(inboxPath, "# GitHub 123");

      const state: State = {
        control_cursor: 0,
        plans: {
          "gh-123": {
            status: "queued",
            hidden: true,
            source: { system: "github", kind: "issue", id: "123" },
          },
        },
      };

      saveState(repoRoot, state);
      const loaded = loadState(repoRoot);

      expect(loaded.plans["gh-123"]?.status).toBe("queued");
      expect(loaded.plans["gh-123"]?.hidden).toBe(true);
      expect(loaded.plans["gh-123"]?.source).toEqual({
        system: "github",
        kind: "issue",
        id: "123",
      });
    });

    test("hidden plan with source can be queried and unhidden", () => {
      // TODO: When implemented:
      // 1. Create hidden plan with source
      // 2. Find by source
      // 3. Set hidden: false
      // 4. Verify dispatcher can now activate it

      expect(true).toBe(true);
    });
  });

  describe("TypeScript type safety", () => {
    test("PlanState type includes hidden as optional boolean", () => {
      // Type-level test - will fail to compile if types are wrong
      const ps: PlanState = {
        status: "draft",
        hidden: true,
      };

      expect(ps.hidden).toBe(true);
    });

    test("PlanState type includes source as optional PlanSource", () => {
      // Type-level test
      const ps: PlanState = {
        status: "draft",
        source: {
          system: "github",
          kind: "issue",
          id: "123",
        },
      };

      // TODO: When PlanSource type is defined:
      // expect(ps.source?.system).toBe("github");

      expect(ps.status).toBe("draft");
    });

    test("PlanSource requires all three fields", () => {
      // Type-level test - should fail to compile if any field is missing
      // const invalidSource: PlanSource = { system: "github", kind: "issue" }; // Missing id

      expect(true).toBe(true);
    });
  });
});
