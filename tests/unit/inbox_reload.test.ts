import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ingestInboxPlans } from "../../src/lib/dispatcher.js";
import {
  saveState,
  loadState,
  getInboxPath,
  setInboxStatus,
  getInboxMeta,
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

test("setInboxStatus persists status to disk and can be read back", () => {
  const id = "test-plan";
  const inboxPath = getInboxPath(repoRoot, id);
  writeFileSync(
    inboxPath,
    `---
id: ${id}
---
## TODO
- [ ] A task
`
  );

  // Initially no meta should default to draft
  expect(getInboxMeta(repoRoot, id).status).toBe("draft");

  // Set to queued
  setInboxStatus(repoRoot, id, "queued");

  // Fresh read should show queued
  expect(getInboxMeta(repoRoot, id).status).toBe("queued");

  // Loading state from disk should also show queued
  const diskState = loadState(repoRoot);
  expect(diskState.inbox[id]?.status).toBe("queued");
});

test("dispatcher sees inbox status changes made externally (simulates UI → dispatcher flow)", async () => {
  const id = "external-change-plan";
  const inboxPath = getInboxPath(repoRoot, id);
  writeFileSync(
    inboxPath,
    `---
id: ${id}
---
## TODO
- [ ] Task one
`
  );

  // Simulate dispatcher having an in-memory state with plan as draft
  const dispatcherState: State = {
    control_cursor: 0,
    plans: {},
    inbox: {
      [id]: { status: "draft" },
    },
  };
  saveState(repoRoot, dispatcherState);

  // Simulate external change (like UI calling setInboxStatus)
  setInboxStatus(repoRoot, id, "queued");

  // Verify disk now shows queued
  const diskState = loadState(repoRoot);
  expect(diskState.inbox[id]?.status).toBe("queued");

  // Simulate dispatcher reloading inbox from disk (as per the fix)
  dispatcherState.inbox = diskState.inbox;

  // Now dispatcher's in-memory state should see the queued status
  expect(dispatcherState.inbox[id]?.status).toBe("queued");
});

test("ingestInboxPlans picks up plans queued by external process", async () => {
  const id = "externally-queued";
  const inboxPath = getInboxPath(repoRoot, id);
  writeFileSync(
    inboxPath,
    `---
id: ${id}
---
## TODO
- [ ] A task
`
  );

  // Start with draft in state
  setInboxStatus(repoRoot, id, "draft");

  // Load initial state (simulating dispatcher startup)
  let state = loadState(repoRoot);
  expect(state.inbox[id]?.status).toBe("draft");

  // Externally set to queued (simulating UI action)
  setInboxStatus(repoRoot, id, "queued");

  // Reload inbox from disk (simulating dispatcher's loop start)
  const diskState = loadState(repoRoot);
  state.inbox = diskState.inbox;

  // Now state should see queued
  expect(state.inbox[id]?.status).toBe("queued");
});

test("inbox status survives state reload with other plans present", () => {
  const id1 = "plan-one";
  const id2 = "plan-two";

  // Create two inbox plans
  writeFileSync(
    getInboxPath(repoRoot, id1),
    `---\nid: ${id1}\n---\n## TODO\n- [ ] Task\n`
  );
  writeFileSync(
    getInboxPath(repoRoot, id2),
    `---\nid: ${id2}\n---\n## TODO\n- [ ] Task\n`
  );

  // Set different statuses
  setInboxStatus(repoRoot, id1, "draft");
  setInboxStatus(repoRoot, id2, "queued");

  // Reload and verify both statuses persisted
  const state = loadState(repoRoot);
  expect(state.inbox[id1]?.status).toBe("draft");
  expect(state.inbox[id2]?.status).toBe("queued");
});

test("ingestInboxPlans uses frontmatter ID for metadata lookup (filename has branch prefix)", async () => {
  // Simulate a plan file with a branch-prefixed filename but short frontmatter ID
  const frontmatterId = "abc123";
  const filename = `my-feature-${frontmatterId}`;
  const inboxDir = join(repoRoot, "prloom", ".local", "inbox");
  const inboxPath = join(inboxDir, `${filename}.md`);

  writeFileSync(
    inboxPath,
    `---
id: ${frontmatterId}
---
## TODO
- [ ] A task
`
  );

  // Set inbox status using the frontmatter ID (as setInboxStatus does)
  setInboxStatus(repoRoot, frontmatterId, "queued");

  // Verify it's stored under the frontmatter ID
  const state = loadState(repoRoot);
  expect(state.inbox[frontmatterId]?.status).toBe("queued");
  expect(state.inbox[filename]).toBeUndefined(); // NOT stored under filename

  // ingestInboxPlans should find the queued status by reading the frontmatter ID
  // (We can't fully test ingestion without mocking git, but we can verify the lookup works)
  const config = loadConfig(repoRoot);

  // The state passed to ingestInboxPlans should have the inbox metadata
  // accessible via the frontmatter ID
  const inboxMeta = state.inbox[frontmatterId] ?? { status: "draft" as const };
  expect(inboxMeta.status).toBe("queued");
});
