/**
 * E2E test: prloom edit starts a fresh session with designer edit prompt.
 *
 * Verifies that `prloom edit` does NOT try to resume an existing session,
 * but instead starts a fresh interactive session with the designer edit prompt.
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from "fs";
import { join } from "path";
import { PassThrough } from "stream";

import { makeTempRepo, writeTestConfig, type TempRepoResult } from "./harness.js";
import { runEdit } from "../../src/cli/edit.js";
import { setPromptIO } from "../../src/cli/prompt.js";

let tempRepo: TempRepoResult;

beforeEach(async () => {
  tempRepo = await makeTempRepo();
});

afterEach(() => {
  tempRepo.cleanup();
  // Reset prompt IO after each test
  setPromptIO(null);
});

/**
 * Create mock streams for the confirmation prompt that automatically answer "n".
 */
function createMockPromptIO(): { input: NodeJS.ReadStream; output: NodeJS.WriteStream } {
  const input = new PassThrough() as unknown as NodeJS.ReadStream;
  const output = new PassThrough() as unknown as NodeJS.WriteStream;
  
  // Auto-answer "n" to any prompt after a short delay
  setTimeout(() => {
    (input as unknown as PassThrough).write("n\n");
  }, 50);
  
  return { input, output };
}

/**
 * Create a capturing opencode shim that records what arguments it was called with.
 */
function createCapturingOpencodeShim(binDir: string, stateDir: string): void {
  const shim = `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const stateDir = process.env.E2E_STATE_DIR || "${stateDir}";
const statePath = path.join(stateDir, "opencode_calls.json");

// Read existing calls
let calls = [];
if (fs.existsSync(statePath)) {
  try {
    calls = JSON.parse(fs.readFileSync(statePath, "utf-8"));
  } catch {}
}

// Record this call
calls.push({
  args: process.argv.slice(2),
  cwd: process.cwd(),
  ts: new Date().toISOString(),
});

fs.mkdirSync(stateDir, { recursive: true });
fs.writeFileSync(statePath, JSON.stringify(calls, null, 2));

// Exit successfully
process.exit(0);
`;

  const opencodePath = join(binDir, "opencode");
  writeFileSync(opencodePath, shim);
  chmodSync(opencodePath, 0o755);
}

/**
 * Read the captured opencode calls.
 */
function readOpencodeCalls(stateDir: string): Array<{ args: string[]; cwd: string; ts: string }> {
  const statePath = join(stateDir, "opencode_calls.json");
  if (!existsSync(statePath)) {
    return [];
  }
  return JSON.parse(readFileSync(statePath, "utf-8"));
}

test("prloom edit starts fresh session with --prompt flag (not --continue)", async () => {
  const { repoRoot, binDir, stateDir, envOverrides } = tempRepo;

  // Set up config
  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
  });

  // Create an inbox plan
  const planId = "test-edit-plan";
  const inboxDir = join(repoRoot, "prloom", ".local", "inbox");
  mkdirSync(inboxDir, { recursive: true });

  const planContent = `# Test Plan

## Objective

Test the edit functionality.

## Context

Some context here.

## TODO

- [ ] First task
- [ ] Second task

## Progress Log

- Initial plan created
`;

  writeFileSync(join(inboxDir, `${planId}.md`), planContent);
  writeFileSync(
    join(inboxDir, `${planId}.json`),
    JSON.stringify({ status: "draft" }, null, 2)
  );

  // Create capturing shim
  createCapturingOpencodeShim(binDir, stateDir);

  // Set up mock prompt IO to auto-answer "n" to confirmation
  setPromptIO(createMockPromptIO());

  // Apply environment overrides
  const originalPath = process.env.PATH;
  const originalStateDir = process.env.E2E_STATE_DIR;
  process.env.PATH = envOverrides.PATH;
  process.env.E2E_STATE_DIR = stateDir;

  try {
    // Run edit (this will call the opencode shim)
    await runEdit(repoRoot, planId, undefined, false);

    // Read captured calls
    const calls = readOpencodeCalls(stateDir);

    // Verify we got exactly one call
    expect(calls.length).toBe(1);

    const call = calls[0];
    if (!call) {
      throw new Error("Expected at least one opencode call");
    }

    // Verify it was called with --prompt (fresh session), NOT --continue (resume)
    expect(call.args).toContain("--prompt");
    expect(call.args).not.toContain("--continue");
    expect(call.args).not.toContain("-c");

    // Verify the prompt contains designer edit content and references the plan path
    const promptIdx = call.args.indexOf("--prompt");
    expect(promptIdx).toBeGreaterThanOrEqual(0);

    const promptContent = call.args[promptIdx + 1];
    if (!promptContent) {
      throw new Error("Expected --prompt to have a value");
    }
    expect(promptContent).toContain("Designer: Edit an Existing Plan");
    expect(promptContent).toContain("Read the current plan from:");
    expect(promptContent).toContain("test-edit-plan.md");
  } finally {
    // Restore environment
    process.env.PATH = originalPath;
    if (originalStateDir !== undefined) {
      process.env.E2E_STATE_DIR = originalStateDir;
    } else {
      delete process.env.E2E_STATE_DIR;
    }
  }
}, 30000);

test("prloom edit prompt includes plan structure guidance", async () => {
  const { repoRoot, binDir, stateDir, envOverrides } = tempRepo;

  // Set up config
  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
  });

  // Create an inbox plan
  const planId = "test-edit-guidance";
  const inboxDir = join(repoRoot, "prloom", ".local", "inbox");
  mkdirSync(inboxDir, { recursive: true });

  const planContent = `# My Feature

## Objective

Build something cool.

## Context

N/A

## TODO

- [ ] Do the thing

## Progress Log
`;

  writeFileSync(join(inboxDir, `${planId}.md`), planContent);
  writeFileSync(
    join(inboxDir, `${planId}.json`),
    JSON.stringify({ status: "draft" }, null, 2)
  );

  // Create capturing shim
  createCapturingOpencodeShim(binDir, stateDir);

  // Set up mock prompt IO to auto-answer "n" to confirmation
  setPromptIO(createMockPromptIO());

  // Apply environment overrides
  const originalPath = process.env.PATH;
  const originalStateDir = process.env.E2E_STATE_DIR;
  process.env.PATH = envOverrides.PATH;
  process.env.E2E_STATE_DIR = stateDir;

  try {
    await runEdit(repoRoot, planId, undefined, false);

    const calls = readOpencodeCalls(stateDir);
    expect(calls.length).toBe(1);

    const call = calls[0];
    if (!call) {
      throw new Error("Expected at least one opencode call");
    }

    const promptIdx = call.args.indexOf("--prompt");
    const promptContent = call.args[promptIdx + 1];
    if (!promptContent) {
      throw new Error("Expected --prompt to have a value");
    }

    // Verify prompt includes plan structure guidance (like designer_new has)
    expect(promptContent).toContain("TODO Rules");
    expect(promptContent).toContain("single commit");
    expect(promptContent).toContain("Plan Structure");
  } finally {
    process.env.PATH = originalPath;
    if (originalStateDir !== undefined) {
      process.env.E2E_STATE_DIR = originalStateDir;
    } else {
      delete process.env.E2E_STATE_DIR;
    }
  }
}, 30000);
