#!/usr/bin/env node
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { resolveRepoRoot } from "../lib/repo_root.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { resolvePlanId } from "../lib/resolver.js";

// Read version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8")
);

async function getRepoRoot(): Promise<string> {
  try {
    return await resolveRepoRoot(process.cwd());
  } catch {
    console.error("Not inside a git repository");
    process.exit(1);
  }
}

yargs(hideBin(process.argv))
  .scriptName("prloom")
  .version(packageJson.version)
  .usage("$0 [command] [options]")

  // Default command: init if needed, then start dispatcher
  .command(
    "$0",
    "Initialize (if needed) and start the dispatcher",
    (yargs) =>
      yargs.option("tmux", {
        type: "boolean",
        describe:
          "Run workers in tmux sessions (auto-enabled if tmux is installed)",
        default: true,
      }),
    async (argv) => {
      const repoRoot = await getRepoRoot();
      const { isInitialized, runInit } = await import("./init.js");

      // Auto-initialize if not already initialized
      if (!isInitialized(repoRoot)) {
        await runInit(repoRoot, { yes: false, force: false });
      }

      const { runDispatcher } = await import("../lib/dispatcher.js");
      const { renderTUI } = await import("../ui/index.js");

      // Start dispatcher in background
      runDispatcher(repoRoot, { tmux: argv.tmux, useTUI: true }).catch(
        (err) => {
          console.error("Dispatcher error:", err);
          process.exit(1);
        }
      );

      // Render TUI (blocks until quit)
      await renderTUI(repoRoot);
    }
  )

  // prloom init
  .command(
    "init",
    "Initialize prloom in this repository",
    (yargs) =>
      yargs
        .option("yes", {
          alias: "y",
          type: "boolean",
          describe: "Accept defaults and avoid prompts",
          default: false,
        })
        .option("force", {
          type: "boolean",
          describe: "Overwrite prloom.config.json if it exists",
          default: false,
        }),
    async (argv) => {
      const { runInit } = await import("./init.js");
      await runInit(await getRepoRoot(), { yes: argv.yes, force: argv.force });
    }
  )

  // prloom new
  .command(
    "new [plan-id]",
    "Create a new plan with Designer",
    (yargs) =>
      yargs
        .positional("plan-id", { type: "string", describe: "Plan ID" })
        .option("agent", {
          type: "string",
          describe: "Coding agent to use (codex, opencode, claude, gemini)",
        })
        .option("model", {
          alias: "m",
          type: "string",
          describe:
            "Model to use for designer agent (e.g., claude-opus-4, gemini-2.5-pro)",
        })
        .option("no-designer", {
          type: "boolean",
          describe: "Create plan skeleton without launching designer session",
          default: false,
        })
        .option("branch", {
          alias: "b",
          type: "string",
          describe: "Preferred branch name (defaults to plan ID)",
        })
        .option("preset", {
          alias: "p",
          type: "string",
          describe:
            "Configuration preset to use (e.g., default, quick, local-only)",
        }),
    async (argv) => {
      const { runNew } = await import("./new.js");
      await runNew(
        await getRepoRoot(),
        argv["plan-id"],
        argv.agent,
        argv["no-designer"],
        argv.model,
        argv.branch,
        argv.preset
      );
    }
  )

  // prloom edit
  .command(
    "edit [plan-id]",
    "Edit an existing plan",
    (yargs) =>
      yargs
        .positional("plan-id", { type: "string" })
        .option("agent", {
          type: "string",
          describe: "Coding agent to use (codex, opencode, claude, gemini)",
        })
        .option("no-designer", {
          type: "boolean",
          describe: "Print plan path without launching designer session",
          default: false,
        }),
    async (argv) => {
      const repoRoot = await getRepoRoot();
      const planIdInput = argv["plan-id"] as string | undefined;
      const { runEdit } = await import("./edit.js");
      await runEdit(repoRoot, planIdInput, argv.agent, argv["no-designer"]);
    }
  )

  // prloom status
  .command(
    "status",
    "Show plan states",
    () => {},
    async () => {
      const { runStatus } = await import("./status.js");
      await runStatus(await getRepoRoot());
    }
  )

  // prloom queue
  .command(
    "queue [plan-id]",
    "Queue a draft plan for dispatch",
    (yargs) => yargs.positional("plan-id", { type: "string" }),
    async (argv) => {
      const { runQueue } = await import("./queue.js");
      const repoRoot = await getRepoRoot();
      await runQueue(repoRoot, argv["plan-id"] as string | undefined);
    }
  )

  // prloom block
  .command(
    "block [plan-id]",
    "Block automation for a plan",
    (yargs) => yargs.positional("plan-id", { type: "string" }),
    async (argv) => {
      const repoRoot = await getRepoRoot();
      const { runBlock } = await import("./block.js");
      await runBlock(repoRoot, argv["plan-id"] as string | undefined);
    }
  )

  // prloom unblock
  .command(
    "unblock [plan-id]",
    "Unblock automation for a plan",
    (yargs) => yargs.positional("plan-id", { type: "string" }),
    async (argv) => {
      const repoRoot = await getRepoRoot();
      const { runUnblock } = await import("./unblock.js");
      await runUnblock(repoRoot, argv["plan-id"] as string | undefined);
    }
  )

  // prloom open
  .command(
    "open [plan-id]",
    "Open TUI for manual work (requires blocked status)",
    (yargs) => yargs.positional("plan-id", { type: "string" }),
    async (argv) => {
      const repoRoot = await getRepoRoot();
      const { runOpen } = await import("./open.js");
      await runOpen(repoRoot, argv["plan-id"] as string | undefined);
    }
  )

  // prloom watch
  .command(
    "watch [plan-id]",
    "Observe a running worker",
    (yargs) => yargs.positional("plan-id", { type: "string" }),
    async (argv) => {
      const repoRoot = await getRepoRoot();
      const { runWatch } = await import("./watch.js");
      await runWatch(repoRoot, argv["plan-id"] as string | undefined);
    }
  )

  // prloom logs
  .command(
    "logs [plan-id]",
    "Show session ID for a plan",
    (yargs) => yargs.positional("plan-id", { type: "string" }),
    async (argv) => {
      const repoRoot = await getRepoRoot();
      const { runLogs } = await import("./logs.js");
      await runLogs(repoRoot, argv["plan-id"] as string | undefined);
    }
  )

  // prloom poll
  .command(
    "poll [plan-id]",
    "Fetch and display PR feedback for a plan (or signal all if no ID)",
    (yargs) =>
      yargs
        .positional("plan-id", {
          type: "string",
          describe: "Plan ID (omit to signal all plans)",
        })
        .option("signal", {
          type: "boolean",
          describe: "Signal dispatcher to poll (instead of displaying)",
          default: false,
        }),
    async (argv) => {
      const repoRoot = await getRepoRoot();
      const planId = argv["plan-id"] as string | undefined;

      if (!planId) {
        // No plan ID: signal all plans (original behavior)
        const { enqueue } = await import("../lib/ipc.js");
        const { loadState } = await import("../lib/state.js");
        const state = loadState(repoRoot);
        const planIds = Object.keys(state.plans);
        if (planIds.length === 0) {
          console.log("No active plans to poll");
        } else {
          for (const id of planIds) {
            enqueue(repoRoot, { type: "launch_poll", plan_id: id });
          }
          console.log(
            `Signaled dispatcher to poll feedback for ${planIds.length} plans`
          );
        }
      } else if (argv.signal) {
        // Signal dispatcher mode
        const id = await resolvePlanId(repoRoot, planId);
        const { enqueue } = await import("../lib/ipc.js");
        enqueue(repoRoot, { type: "poll", plan_id: id });
        console.log(`Signaled dispatcher to poll feedback for ${id}`);
      } else {
        // Display mode - show feedback directly
        const id = await resolvePlanId(repoRoot, planId);
        const { runPoll } = await import("./poll.js");
        await runPoll(repoRoot, id);
      }
    }
  )

  // prloom clean
  .command(
    "clean",
    "Remove stale inbox plans",
    () => {},
    async () => {
      const { runClean } = await import("./clean.js");
      await runClean(await getRepoRoot());
    }
  )

  // prloom delete
  .command(
    "delete [plan-id]",
    "Delete a plan (removes worktree or inbox files)",
    (yargs) =>
      yargs
        .positional("plan-id", {
          type: "string",
          describe: "Plan ID to delete",
        })
        .option("force", {
          alias: "f",
          type: "boolean",
          describe: "Skip confirmation prompt",
          default: false,
        }),
    async (argv) => {
      const repoRoot = await getRepoRoot();
      const { runDelete } = await import("./delete.js");
      await runDelete(
        repoRoot,
        argv["plan-id"] as string | undefined,
        argv.force
      );
    }
  )

  .strict()
  .help()
  .parse();
