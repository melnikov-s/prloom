import { statSync } from "fs";
import {
  listInboxPlanIds,
  deleteInboxPlan,
  getInboxPath,
} from "../lib/state.js";

export async function runClean(repoRoot: string): Promise<void> {
  const planIds = listInboxPlanIds(repoRoot);

  if (planIds.length === 0) {
    console.log("Inbox is empty. Nothing to clean.");
    return;
  }

  console.log("Inbox plans:");
  console.log("");

  for (const id of planIds) {
    const filePath = getInboxPath(repoRoot, id);
    try {
      const stat = statSync(filePath);
      const created = stat.birthtime.toLocaleString();
      console.log(`  ${id}.md  (created: ${created})`);
    } catch {
      console.log(`  ${id}.md`);
    }
  }

  console.log("");
  console.log(`Found ${planIds.length} plan(s) in inbox.`);
  console.log("");

  // Interactive confirmation
  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question("Delete all inbox plans? [y/N] ", resolve);
  });
  rl.close();

  if (answer.toLowerCase() !== "y") {
    console.log("Aborted.");
    return;
  }

  for (const id of planIds) {
    deleteInboxPlan(repoRoot, id);
    console.log(`Deleted: ${id}.md`);
  }

  console.log("");
  console.log("Inbox cleaned.");
}
