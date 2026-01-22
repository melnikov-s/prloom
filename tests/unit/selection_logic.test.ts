import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runQueue } from "../../src/cli/queue.js";
import { runBlock } from "../../src/cli/block.js";
import { runUnblock } from "../../src/cli/unblock.js";
import { runResume } from "../../src/cli/resume.js";
import { runOpen } from "../../src/cli/open.js";
import { runWatch } from "../../src/cli/watch.js";
import { runLogs } from "../../src/cli/logs.js";

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "prloom-selection-test-"));
  mkdirSync(join(repoRoot, "prloom", ".local", "inbox"), { recursive: true });
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true });
});

test("runQueue handles empty inbox without ID", async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  try {
    await runQueue(repoRoot, undefined);
  } finally {
    console.log = originalLog;
  }

  expect(logs.join("\n")).toContain("No draft plans found in inbox.");
});

test("runBlock handles empty state without ID", async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  try {
    await runBlock(repoRoot, undefined);
  } finally {
    console.log = originalLog;
  }

  expect(logs.join("\n")).toContain("No blockable plans found.");
});

test("runUnblock handles empty state without ID", async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  try {
    await runUnblock(repoRoot, undefined);
  } finally {
    console.log = originalLog;
  }

  expect(logs.join("\n")).toContain("No blocked plans found.");
});

test("runOpen handles empty state without ID", async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  try {
    await runOpen(repoRoot, undefined);
  } finally {
    console.log = originalLog;
  }

  expect(logs.join("\n")).toContain("No blocked or paused plans found to open.");
});

test("runResume handles empty state without ID", async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  try {
    await runResume(repoRoot, undefined);
  } finally {
    console.log = originalLog;
  }

  expect(logs.join("\n")).toContain("No paused plans found.");
});

test("runWatch handles empty state without ID", async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  try {
    await runWatch(repoRoot, undefined);
  } finally {
    console.log = originalLog;
  }

  expect(logs.join("\n")).toContain("No active tmux sessions found to watch.");
});

test("runLogs handles empty state without ID", async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  try {
    await runLogs(repoRoot, undefined);
  } finally {
    console.log = originalLog;
  }

  expect(logs.join("\n")).toContain("No active plans found.");
});
