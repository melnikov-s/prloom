import { describe, it, expect } from "bun:test";
import {
  spawnDetached,
  isProcessAlive,
  killProcess,
  waitForProcess,
} from "../../src/lib/adapters/process.js";

describe("process utilities", () => {
  describe("spawnDetached", () => {
    it("spawns a process and returns a valid PID", () => {
      const pid = spawnDetached("sleep", ["0.1"]);
      expect(typeof pid).toBe("number");
      expect(pid).toBeGreaterThan(0);
    });

    it("spawns a long-running process that stays alive", async () => {
      const pid = spawnDetached("sleep", ["10"]);
      expect(isProcessAlive(pid)).toBe(true);

      // Clean up
      killProcess(pid);
    });
  });

  describe("isProcessAlive", () => {
    it("returns true for a running process", () => {
      const pid = spawnDetached("sleep", ["10"]);
      expect(isProcessAlive(pid)).toBe(true);
      killProcess(pid);
    });

    it("returns false for a non-existent PID", () => {
      // Use a very high PID that's unlikely to exist
      expect(isProcessAlive(999999999)).toBe(false);
    });

    it("returns false after process exits", async () => {
      const pid = spawnDetached("sleep", ["0.1"]);
      // Wait for it to finish
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(isProcessAlive(pid)).toBe(false);
    });
  });

  describe("killProcess", () => {
    it("kills a running process", () => {
      const pid = spawnDetached("sleep", ["10"]);
      expect(isProcessAlive(pid)).toBe(true);

      const killed = killProcess(pid);
      expect(killed).toBe(true);

      // Give it a moment to die
      setTimeout(() => {
        expect(isProcessAlive(pid)).toBe(false);
      }, 100);
    });

    it("returns false for non-existent process", () => {
      const killed = killProcess(999999999);
      expect(killed).toBe(false);
    });
  });

  describe("waitForProcess", () => {
    it("waits for a short process to complete", async () => {
      const pid = spawnDetached("sleep", ["0.2"]);
      expect(isProcessAlive(pid)).toBe(true);

      await waitForProcess(pid, 50);
      expect(isProcessAlive(pid)).toBe(false);
    });

    it("returns immediately if process already dead", async () => {
      const pid = spawnDetached("true", []); // exits immediately
      await new Promise((resolve) => setTimeout(resolve, 50));

      const start = Date.now();
      await waitForProcess(pid, 100);
      const elapsed = Date.now() - start;

      // Should return quickly, not wait for poll interval
      expect(elapsed).toBeLessThan(150);
    });
  });
});
