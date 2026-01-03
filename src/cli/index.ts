#!/usr/bin/env node
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

yargs(hideBin(process.argv))
  .scriptName("swarm")
  .usage("$0 <command> [options]")

  // swarm new
  .command(
    "new [plan-id]",
    "Create a new plan with Designer",
    (yargs) =>
      yargs.positional("plan-id", { type: "string", describe: "Plan ID" }),
    async (argv) => {
      const { runNew } = await import("./new.js");
      await runNew(process.cwd(), argv["plan-id"]);
    }
  )

  // swarm edit
  .command(
    "edit <plan-id>",
    "Edit an existing plan",
    (yargs) =>
      yargs.positional("plan-id", { type: "string", demandOption: true }),
    async (argv) => {
      const { runEdit } = await import("./edit.js");
      await runEdit(process.cwd(), argv["plan-id"] as string);
    }
  )

  // swarm start
  .command(
    "start",
    "Start the dispatcher",
    () => {},
    async () => {
      const { runDispatcher } = await import("../lib/dispatcher.js");
      await runDispatcher(process.cwd());
    }
  )

  // swarm status
  .command(
    "status",
    "Show plan states",
    () => {},
    async () => {
      const { runStatus } = await import("./status.js");
      await runStatus(process.cwd());
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
      await runStop(process.cwd(), argv["plan-id"] as string);
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
      await runUnpause(process.cwd(), argv["plan-id"] as string);
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
      await runOpen(process.cwd(), argv["plan-id"] as string);
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
      await runLogs(process.cwd(), argv["plan-id"] as string);
    }
  )

  .demandCommand(1, "You need to specify a command")
  .strict()
  .help()
  .parse();
