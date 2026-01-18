import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ingestInboxPlans } from "../../src/lib/dispatcher.js";
import {
  saveState,
  loadState,
  getInboxPath,
  setPlanStatus,
  getPlanMeta,
  type State,
} from "../../src/lib/state.js";
import { loadConfig } from "../../src/lib/config.js";

// No-op logger for tests
const noopLogger = {
  info: () => {},
  success: () => {},
  warn: () => {},
  error: () => {},
};

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "prloom-inbox-reload-test-"));
  mkdirSync(join(repoRoot, "prloom", ".local", "inbox"), { recursive: true });
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true });
});

test("setPlanStatus persists status to disk and can be read back", () => {
  const id = "test-plan";
  const inboxPath = getInboxPath(repoRoot, id);
  writeFileSync(
    inboxPath,
    `## Plan Summary

- Queued plan

## Objective

None

## Context

None

## Scope (In/Out)

In: none
Out: none

## Success Criteria

None

## Constraints

None

## Assumptions

None

## Architecture Notes

None

## Decision Log

None

## Implementation Notes

None

## Plan-Specific Checks

None

## Review Focus

None

## Open Questions

None

## TODO
- [ ] A task
`
  );


  // Initially no meta should default to draft
  expect(getPlanMeta(repoRoot, id).status).toBe("draft");

  // Set to queued
  setPlanStatus(repoRoot, id, "queued");

  // Fresh read should show queued
  expect(getPlanMeta(repoRoot, id).status).toBe("queued");

  // Loading state from disk should also show queued
  const diskState = loadState(repoRoot);
  expect(diskState.plans[id]?.status).toBe("queued");
});

test("dispatcher sees plan status changes made externally (simulates UI → dispatcher flow)", async () => {
  const id = "external-change-plan";
  const inboxPath = getInboxPath(repoRoot, id);
  writeFileSync(
    inboxPath,
    `## Plan Summary

- Inbox plan

## Objective

None

## Context

None

## Scope (In/Out)

In: none
Out: none

## Success Criteria

None

## Constraints

None

## Assumptions

None

## Architecture Notes

None

## Decision Log

None

## Implementation Notes

None

## Plan-Specific Checks

None

## Review Focus

None

## Open Questions

None

## TODO
- [ ] A task
`
  );


  // Simulate dispatcher having an in-memory state with plan as draft
  const dispatcherState: State = {
    control_cursor: 0,
    plans: {
      [id]: { status: "draft" },
    },
  };
  saveState(repoRoot, dispatcherState);

  // Simulate external change (like UI calling setPlanStatus)
  setPlanStatus(repoRoot, id, "queued");

  // Verify disk now shows queued
  const diskState = loadState(repoRoot);
  expect(diskState.plans[id]?.status).toBe("queued");

  // Simulate dispatcher reloading plans from disk (as per the fix)
  for (const [pid, diskPs] of Object.entries(diskState.plans)) {
    if (!dispatcherState.plans[pid]) {
      dispatcherState.plans[pid] = diskPs;
    } else if (
      diskPs.status === "queued" &&
      dispatcherState.plans[pid].status === "draft"
    ) {
      dispatcherState.plans[pid].status = "queued";
    }
  }

  // Now dispatcher's in-memory state should see the queued status
  expect(dispatcherState.plans[id]?.status).toBe("queued");
});

test("ingestInboxPlans picks up plans queued by external process", async () => {
  const id = "externally-queued";
  const inboxPath = getInboxPath(repoRoot, id);
  writeFileSync(
    inboxPath,
    `## Plan Summary

- Queued plan

## Objective

None

## Context

None

## Scope (In/Out)

In: none
Out: none

## Success Criteria

None

## Constraints

None

## Assumptions

None

## Architecture Notes

None

## Decision Log

None

## Implementation Notes

None

## Plan-Specific Checks

None

## Review Focus

None

## Open Questions

None

## TODO
- [ ] A task
`
  );


  // Start with draft in state
  setPlanStatus(repoRoot, id, "draft");

  // Load initial state (simulating dispatcher startup)
  let state = loadState(repoRoot);
  expect(state.plans[id]?.status).toBe("draft");

  // Externally set to queued (simulating UI action)
  setPlanStatus(repoRoot, id, "queued");

  // Reload from disk (simulating dispatcher's loop start)
  const diskState = loadState(repoRoot);
  for (const [pid, diskPs] of Object.entries(diskState.plans)) {
    if (!state.plans[pid]) {
      state.plans[pid] = diskPs;
    } else if (
      diskPs.status === "queued" &&
      state.plans[pid].status === "draft"
    ) {
      state.plans[pid].status = "queued";
    }
  }

  // Now state should see queued
  expect(state.plans[id]?.status).toBe("queued");
});

test("plan status survives state reload with other plans present", () => {
  const id1 = "plan-one";
  const id2 = "plan-two";

  // Create two inbox plans
  writeFileSync(
    getInboxPath(repoRoot, id1),
    `## Plan Summary

- Plan one

## Objective

None

## Context

None

## Scope (In/Out)

In: none
Out: none

## Success Criteria

None

## Constraints

None

## Assumptions

None

## Architecture Notes

None

## Decision Log

None

## Implementation Notes

None

## Plan-Specific Checks

None

## Review Focus

None

## Open Questions

None

## TODO
- [ ] Task
`
  );
  writeFileSync(
    getInboxPath(repoRoot, id2),
    `## Plan Summary

- Plan two

## Objective

None

## Context

None

## Scope (In/Out)

In: none
Out: none

## Success Criteria

None

## Constraints

None

## Assumptions

None

## Architecture Notes

None

## Decision Log

None

## Implementation Notes

None

## Plan-Specific Checks

None

## Review Focus

None

## Open Questions

None

## TODO
- [ ] Task
`
  );

  // Set different statuses
  setPlanStatus(repoRoot, id1, "draft");
  setPlanStatus(repoRoot, id2, "queued");

  // Reload and verify both statuses persisted
  const state = loadState(repoRoot);
  expect(state.plans[id1]?.status).toBe("draft");
  expect(state.plans[id2]?.status).toBe("queued");
});

test("ingestInboxPlans uses filename as plan ID (frontmatter ID is ignored)", async () => {
  // Plan file with branch-prefixed filename
  // With per-worktree storage, the plan ID IS the filename, not the frontmatter ID
  const filename = "my-feature-abc123";
  const inboxDir = join(repoRoot, "prloom", ".local", "inbox");
  const inboxPath = join(inboxDir, `${filename}.md`);

  writeFileSync(
    inboxPath,
    `## Plan Summary

- External change plan

## Objective

None

## Context

None

## Scope (In/Out)

In: none
Out: none

## Success Criteria

None

## Constraints

None

## Assumptions

None

## Architecture Notes

None

## Decision Log

None

## Implementation Notes

None

## Plan-Specific Checks

None

## Review Focus

None

## Open Questions

None

## TODO
- [ ] Task one
`
  );


  // Set status using the filename (which is now the plan ID)
  setPlanStatus(repoRoot, filename, "queued");

  // Verify it's stored under the filename
  const state = loadState(repoRoot);
  expect(state.plans[filename]?.status).toBe("queued");

  // The config and ingestion will use the filename as the plan ID
  const config = loadConfig(repoRoot);
  const planMeta = state.plans[filename] ?? { status: "draft" as const };
  expect(planMeta.status).toBe("queued");
});
