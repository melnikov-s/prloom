import { test, expect } from "bun:test";
import { execa } from "execa";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

test("CLI reports not inside git repository", async () => {
  const dir = mkdtempSync(join(tmpdir(), "prloom-no-git-"));

  try {
    const res = await execa(
      "bun",
      ["run", join(process.cwd(), "src/cli/index.ts"), "status"],
      {
        cwd: dir,
        reject: false,
      }
    );

    expect(res.exitCode).toBe(1);
    expect(res.stderr + res.stdout).toContain("Not inside a git repository");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
