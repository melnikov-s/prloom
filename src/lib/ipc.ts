import { join } from "path";
import {
  existsSync,
  readFileSync,
  appendFileSync,
  statSync,
  mkdirSync,
} from "fs";

export interface IpcCommand {
  type: "stop" | "unpause" | "poll" | "launch_poll";
  plan_id: string;
  ts: string;
}

const CONTROL_FILE = "control.jsonl";

function getControlPath(repoRoot: string): string {
  return join(repoRoot, ".prloom", CONTROL_FILE);
}

export function enqueue(repoRoot: string, cmd: Omit<IpcCommand, "ts">): void {
  const prloomDir = join(repoRoot, ".prloom");
  if (!existsSync(prloomDir)) {
    mkdirSync(prloomDir, { recursive: true });
  }

  const path = getControlPath(repoRoot);
  const line = JSON.stringify({ ...cmd, ts: new Date().toISOString() }) + "\n";
  appendFileSync(path, line);
}

export function consume(
  repoRoot: string,
  cursor: number
): { commands: IpcCommand[]; newCursor: number } {
  const path = getControlPath(repoRoot);

  if (!existsSync(path)) {
    return { commands: [], newCursor: cursor };
  }

  const stat = statSync(path);
  if (stat.size <= cursor) {
    return { commands: [], newCursor: cursor };
  }

  const content = readFileSync(path, "utf-8").slice(cursor);

  const lines = content.split("\n").filter((line) => line.trim());
  const commands: IpcCommand[] = [];

  for (const line of lines) {
    try {
      commands.push(JSON.parse(line));
    } catch {
      // Skip malformed lines
    }
  }

  return { commands, newCursor: stat.size };
}
