import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { enqueue, consume } from "../../src/lib/ipc.js";

const TEST_DIR = "/tmp/prloom-test-ipc";

beforeEach(() => {
  mkdirSync(join(TEST_DIR, "prloom", ".local"), { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

test("enqueue appends command to control.jsonl", () => {
  enqueue(TEST_DIR, { type: "stop", plan_id: "test-plan" });

  const content = readFileSync(
    join(TEST_DIR, "prloom", ".local", "control.jsonl"),
    "utf-8"
  );
  const line = JSON.parse(content.trim());

  expect(line.type).toBe("stop");
  expect(line.plan_id).toBe("test-plan");
  expect(line.ts).toBeDefined();
});

test("consume returns commands from cursor", () => {
  enqueue(TEST_DIR, { type: "stop", plan_id: "plan-1" });
  enqueue(TEST_DIR, { type: "unpause", plan_id: "plan-2" });
  enqueue(TEST_DIR, { type: "poll", plan_id: "plan-3" });
  enqueue(TEST_DIR, { type: "launch_poll", plan_id: "plan-4" });

  const { commands, newCursor } = consume(TEST_DIR, 0);

  expect(commands).toHaveLength(4);
  expect(commands[0]?.type).toBe("stop");
  expect(commands[1]?.type).toBe("unpause");
  expect(commands[2]?.type).toBe("poll");
  expect(commands[3]?.type).toBe("launch_poll");
  expect(newCursor).toBeGreaterThan(0);
});

test("consume from cursor skips already-read commands", () => {
  enqueue(TEST_DIR, { type: "stop", plan_id: "plan-1" });

  const first = consume(TEST_DIR, 0);
  expect(first.commands).toHaveLength(1);

  enqueue(TEST_DIR, { type: "poll", plan_id: "plan-2" });

  const second = consume(TEST_DIR, first.newCursor);
  expect(second.commands).toHaveLength(1);
  expect(second.commands[0]?.type).toBe("poll");
});

test("consume returns empty when no new commands", () => {
  const { commands, newCursor } = consume(TEST_DIR, 0);

  expect(commands).toHaveLength(0);
  expect(newCursor).toBe(0);
});
