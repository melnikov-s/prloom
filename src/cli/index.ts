#!/usr/bin/env node
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { resolveRepoRoot } from "../lib/repo_root.js";

async function getRepoRoot(): Promise<string> {
  try {
    return await resolveRepoRoot(process.cwd());
  } catch {
    console.error("Not inside a git repository");
    process.exit(1);
  }
}

yargs(hideBin(process.argv))
  .scriptName("swarm")
  .usage("$0 <command> [options]")

  // swarm init
  .command(
    "init",
    "Initialize swarm in this repository",
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
          describe: "Overwrite swarm.config.json if it exists",
          default: false,
        }),
    async (argv) => {
      const { runInit } = await import("./init.js");
      await runInit(await getRepoRoot(), { yes: argv.yes, force: argv.force });
    }
  )

  // swarm new
  .command(
    "new [plan-id]",
    "Create a new plan with Designer",
    (yargs) =>
      yargs
        .positional("plan-id", { type: "string", describe: "Plan ID" })
        .option("agent", {
          type: "string",
          describe: "Coding agent to use (codex, opencode, claude, manual)",
        })
        .option("no-designer", {
          type: "boolean",
          describe: "Create plan skeleton without launching designer session",
          default: false,
        }),
    async (argv) => {
      const { runNew } = await import("./new.js");
      await runNew(
        await getRepoRoot(),
        argv["plan-id"],
        argv.agent,
        argv["no-designer"]
      );
    }
  )

  // swarm edit
  .command(
    "edit <plan-id>",
    "Edit an existing plan",
    (yargs) =>
      yargs
        .positional("plan-id", { type: "string", demandOption: true })
        .option("agent", {
          type: "string",
          describe: "Coding agent to use (codex, opencode, claude, manual)",
        })
        .option("no-designer", {
          type: "boolean",
          describe: "Print plan path without launching designer session",
          default: false,
        }),
    async (argv) => {
      const { runEdit } = await import("./edit.js");
      await runEdit(
        await getRepoRoot(),
        argv["plan-id"] as string,
        argv.agent,
        argv["no-designer"]
      );
    }
  )

  // swarm start
  .command(
    "start",
    "Start the dispatcher",
    () => {},
    async () => {
      const { runDispatcher } = await import("../lib/dispatcher.js");
      await runDispatcher(await getRepoRoot());
    }
  )

  // swarm status
  .command(
    "status",
    "Show plan states",
    () => {},
    async () => {
      const { runStatus } = await import("./status.js");
      await runStatus(await getRepoRoot());
    }
  )

  // swarm stop
  .command(
    "stop <plan-id>",
    "Pause automation for a plan",
    (yargs) =>
      yargs.positional("plan-id", { type: "string", demandOption: true }),
    async (argv) => {
      const { runStop } = await import("./stop.js");
      await runStop(await getRepoRoot(), argv["plan-id"] as string);
    }
  )

  // swarm unpause
  .command(
    "unpause <plan-id>",
    "Resume automation for a plan",
    (yargs) =>
      yargs.positional("plan-id", { type: "string", demandOption: true }),
    async (argv) => {
      const { runUnpause } = await import("./unpause.js");
      await runUnpause(await getRepoRoot(), argv["plan-id"] as string);
    }
  )

  // swarm open
  .command(
    "open <plan-id>",
    "Open TUI for manual work (requires paused)",
    (yargs) =>
      yargs.positional("plan-id", { type: "string", demandOption: true }),
    async (argv) => {
      const { runOpen } = await import("./open.js");
      await runOpen(await getRepoRoot(), argv["plan-id"] as string);
    }
  )

  // swarm logs
  .command(
    "logs <plan-id>",
    "Show session ID for a plan",
    (yargs) =>
      yargs.positional("plan-id", { type: "string", demandOption: true }),
    async (argv) => {
      const { runLogs } = await import("./logs.js");
      await runLogs(await getRepoRoot(), argv["plan-id"] as string);
    }
  )

  // swarm poll
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
        const { enqueue } = await import("../lib/ipc.js");
        enqueue(repoRoot, { type: "poll", plan_id: planId });
        console.log(`Signaled dispatcher to poll feedback for ${planId}`);
      } else {
        // Display mode - show feedback directly
        const { runPoll } = await import("./poll.js");
        await runPoll(repoRoot, planId);
      }
    }
  )

  .demandCommand(1, "You need to specify a command")
  .strict()
  .help()
  .parse();
