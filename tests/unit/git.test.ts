import { test, expect } from "bun:test";
import { createBranchName } from "../../src/lib/git.js";

test("createBranchName slugifies input", async () => {
  const name = "My Cool Feature! (v1)";
  const branch = await createBranchName(name);

  expect(branch).toMatch(/^my-cool-feature-v1-[a-z0-9]{5}$/);
});

test("createBranchName handles special characters", async () => {
  const name = "feature/api_v2";
  const branch = await createBranchName(name);

  expect(branch).toMatch(/^feature\/api_v2-[a-z0-9]{5}$/);
});

test("createBranchName handles empty leading/trailing dashes", async () => {
  const name = "--feature-name--";
  const branch = await createBranchName(name);

  expect(branch).toMatch(/^feature-name-[a-z0-9]{5}$/);
});
