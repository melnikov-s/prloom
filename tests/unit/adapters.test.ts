import { test, expect } from "bun:test";
import {
  getAdapter,
  getAgentNames,
  isAgentName,
} from "../../src/lib/adapters/index.js";

test("isAgentName returns true for valid agent names", () => {
  expect(isAgentName("amp")).toBe(true);
  expect(isAgentName("claude")).toBe(true);
  expect(isAgentName("codex")).toBe(true);
  expect(isAgentName("gemini")).toBe(true);
  expect(isAgentName("opencode")).toBe(true);
});

test("isAgentName returns false for invalid names", () => {
  expect(isAgentName("invalid")).toBe(false);
  expect(isAgentName("")).toBe(false);
  expect(isAgentName("AMP")).toBe(false);
  expect(isAgentName("CODEX")).toBe(false);
});

test("getAdapter returns correct adapter for amp", () => {
  const adapter = getAdapter("amp");
  expect(adapter.name).toBe("amp");
  expect(typeof adapter.execute).toBe("function");
  expect(typeof adapter.interactive).toBe("function");
});

test("getAdapter returns correct adapter for claude", () => {
  const adapter = getAdapter("claude");
  expect(adapter.name).toBe("claude");
});

test("getAdapter returns correct adapter for codex", () => {
  const adapter = getAdapter("codex");
  expect(adapter.name).toBe("codex");
});

test("getAdapter returns correct adapter for gemini", () => {
  const adapter = getAdapter("gemini");
  expect(adapter.name).toBe("gemini");
});

test("getAdapter returns correct adapter for opencode", () => {
  const adapter = getAdapter("opencode");
  expect(adapter.name).toBe("opencode");
});

test("getAdapter throws for unknown agent", () => {
  expect(() => getAdapter("unknown" as any)).toThrow("Unknown agent: unknown");
});

test("getAgentNames returns all registered agents", () => {
  const names = getAgentNames();
  expect(names).toContain("amp");
  expect(names).toContain("claude");
  expect(names).toContain("codex");
  expect(names).toContain("gemini");
  expect(names).toContain("opencode");
  expect(names.length).toBe(5);
});
