import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { BUILTIN_PROMPTS } from "../../src/lib/prompt_sources.js";

test("prompt_sources matches prompts directory files", () => {
  const repoRoot = join(import.meta.dir, "..", "..");
  const promptsDir = join(repoRoot, "prompts");

  expect(BUILTIN_PROMPTS.designer).toBe(
    readFileSync(join(promptsDir, "designer.md"), "utf-8")
  );
  expect(BUILTIN_PROMPTS.worker).toBe(
    readFileSync(join(promptsDir, "worker.md"), "utf-8")
  );
  expect(BUILTIN_PROMPTS.review_triage).toBe(
    readFileSync(join(promptsDir, "review_triage.md"), "utf-8")
  );
});
