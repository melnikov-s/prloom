/**
 * E2E-ish test: TUI new plan flow.
 *
 * Uses Ink rendering with a simulated stdin/stdout to verify that
 * pressing "n" launches plan creation and respects branch input
 * alongside preset selection.
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { PassThrough } from "stream";

import { makeTempRepo, writeTestConfig, type TempRepoResult } from "./harness.js";
import { renderTUI } from "../../src/ui/index.js";

let tempRepo: TempRepoResult;

beforeEach(async () => {
  tempRepo = await makeTempRepo();
});

afterEach(() => {
  tempRepo.cleanup();
});

type InkInput = NodeJS.ReadStream & {
  setRawMode: (mode: boolean) => InkInput;
  ref: () => InkInput;
  unref: () => InkInput;
  isTTY: boolean;
};

type InkOutput = NodeJS.WriteStream & {
  isTTY: boolean;
  columns: number;
  rows: number;
};

function createInkStreams(): { stdin: InkInput; stdout: InkOutput } {
  const stdin = new PassThrough() as unknown as InkInput;
  const stdout = new PassThrough() as unknown as InkOutput;

  stdin.setRawMode = () => stdin;
  stdin.ref = () => stdin;
  stdin.unref = () => stdin;
  stdin.isTTY = true;
  stdin.setEncoding("utf8");
  stdout.isTTY = true;
  stdout.columns = 80;
  stdout.rows = 24;

  return { stdin, stdout };
}

function waitForUiTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

async function typeText(input: InkInput, text: string): Promise<void> {
  for (const char of text) {
    input.write(char);
    await waitForUiTick();
  }
}

test("tui: N starts plan with branch and selected preset", async () => {
  const { repoRoot } = tempRepo;

  writeTestConfig(repoRoot, {
    presets: {
      default: {},
      fast: {},
    },
  });

  const { stdin, stdout } = createInkStreams();
  const spawnCalls: string[][] = [];

  const renderPromise = renderTUI(repoRoot, {
    stdin,
    stdout,
    spawnPlan: (args) => spawnCalls.push(args),
  });

  await waitForUiTick();
  stdin.write("n");
  await waitForUiTick();
  await typeText(stdin, "feature-branch");
  await waitForUiTick();
  stdin.write("\u001b[B");
  await waitForUiTick();
  stdin.write("\r");

  await renderPromise;
  stdin.end();
  stdout.end();

  expect(spawnCalls).toEqual([["new", "--branch", "feature-branch", "--preset", "fast"]]);
}, 10000);

test("tui: N without presets still prompts for branch", async () => {
  const { repoRoot } = tempRepo;

  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
  });

  const { stdin, stdout } = createInkStreams();
  const spawnCalls: string[][] = [];

  const renderPromise = renderTUI(repoRoot, {
    stdin,
    stdout,
    spawnPlan: (args) => spawnCalls.push(args),
  });

  await waitForUiTick();
  stdin.write("n");
  await waitForUiTick();
  await typeText(stdin, "solo-branch");
  await waitForUiTick();
  stdin.write("\r");

  await renderPromise;
  stdin.end();
  stdout.end();

  expect(spawnCalls).toEqual([["new", "--branch", "solo-branch"]]);
}, 10000);
