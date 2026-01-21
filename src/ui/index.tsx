import React, { useState, useEffect, useCallback } from "react";
import { render, useInput, useApp } from "ink";
import { join } from "path";
import { existsSync } from "fs";
import { App, getAvailableActions, type ActionDef } from "./App.js";
import { dispatcherEvents, type DispatcherUIState } from "../lib/events.js";
import { loadConfig, getPresetNames } from "../lib/config.js";
import { loadState, setPlanStatus } from "../lib/state.js";
import { parsePlan } from "../lib/plan.js";
import { enqueue, type IpcCommand } from "../lib/ipc.js";

interface TUIRunnerProps {
  repoRoot: string;
  spawnPlan?: (args: string[]) => void;
}

interface RenderTUIOptions {
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  spawnPlan?: (args: string[]) => void;
}

function TUIRunner({
  repoRoot,
  spawnPlan,
}: TUIRunnerProps): React.ReactElement {
  const { exit } = useApp();

  const [uiState, setUIState] = useState<DispatcherUIState>(
    dispatcherEvents.getUIState(),
  );
  const [planTodos, setPlanTodos] = useState<
    Map<string, { done: number; total: number }>
  >(new Map());

  // Navigation state
  const [selectedPlanIndex, setSelectedPlanIndex] = useState(0);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);
  const [isInActionMode, setIsInActionMode] = useState(false);
  const [isCreatingPlan, setIsCreatingPlan] = useState(false);
  const [newPlanBranch, setNewPlanBranch] = useState("");
  const [newPlanBranchError, setNewPlanBranchError] = useState<string | null>(
    null,
  );
  const [newPlanPresets, setNewPlanPresets] = useState<string[]>([]);
  const [selectedPresetIndex, setSelectedPresetIndex] = useState(0);

  // Get plan IDs for navigation
  const allPlanIds = Object.keys(uiState.state.plans);
  const planCount = allPlanIds.length;

  // Get current plan info
  const currentPlanId = allPlanIds[selectedPlanIndex];
  const currentStatus = currentPlanId
    ? (uiState.state.plans[currentPlanId]?.status ?? "draft")
    : "active";
  const availableActions = getAvailableActions(currentStatus);

  // Execute an action for a plan
  const executeAction = useCallback(
    async (action: ActionDef, planId: string) => {
      if (action.key === "activate") {
        // Handle activate action directly - set inbox status to queued
        setPlanStatus(repoRoot, planId, "queued");
        // Refresh state to update TUI
        const newState = loadState(repoRoot);
        dispatcherEvents.setState(newState);
      } else if (action.ipcType) {
        // Send IPC command (exclude activate since it's handled above)
        enqueue(repoRoot, {
          type: action.ipcType as IpcCommand["type"],
          plan_id: planId,
        });
      } else if (action.command === "edit") {
        // Edit command: run synchronously then restart TUI
        exit();
        const { spawnSync } = await import("child_process");
        spawnSync("prloom", [action.command, planId], {
          stdio: "inherit",
        });
        // After the edit process completes, restart the TUI
        spawnSync("prloom", ["start"], {
          stdio: "inherit",
        });
      } else if (action.command) {
        // For watch/logs, we need to spawn a new process
        // Since we're in the TUI, we'll exit and run the command
        exit();
        const { spawn } = await import("child_process");
        spawn("prloom", [action.command, planId], {
          stdio: "inherit",
          detached: true,
        });
      }
    },
    [repoRoot, exit],
  );

  const startNewPlan = useCallback(
    async (branch: string, preset?: string) => {
      exit();
      const args = ["new", "--branch", branch];
      if (preset) {
        args.push("--preset", preset);
      }
      if (spawnPlan) {
        spawnPlan(args);
        return;
      }
      const { spawnSync } = await import("child_process");
      spawnSync("prloom", args, {
        stdio: "inherit",
      });
      // After the new plan process completes, restart the TUI
      const { spawnSync: restartSync } = await import("child_process");
      restartSync("prloom", ["start"], {
        stdio: "inherit",
      });
    },
    [exit, spawnPlan],
  );

  const openNewPlanDialog = useCallback(() => {
    const config = loadConfig(repoRoot);
    const presets = getPresetNames(config);
    setNewPlanBranch("");
    setNewPlanBranchError(null);
    setNewPlanPresets(presets);
    setSelectedPresetIndex(0);
    setIsCreatingPlan(true);
  }, [repoRoot]);

  const closeNewPlanDialog = useCallback(() => {
    setIsCreatingPlan(false);
    setNewPlanBranch("");
    setNewPlanBranchError(null);
    setNewPlanPresets([]);
    setSelectedPresetIndex(0);
  }, []);

  // Handle keyboard input
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }

    if (isCreatingPlan) {
      const presetCount = newPlanPresets.length;

      if (key.escape) {
        closeNewPlanDialog();
        return;
      }

      if (key.return) {
        const trimmedBranch = newPlanBranch.trim();
        if (!trimmedBranch) {
          setNewPlanBranchError("Branch name is required.");
          return;
        }
        const preset =
          presetCount > 0 ? newPlanPresets[selectedPresetIndex] : undefined;
        startNewPlan(trimmedBranch, preset);
        return;
      }

      if (key.backspace || key.delete) {
        setNewPlanBranch((prev) => prev.slice(0, -1));
        if (newPlanBranchError) {
          setNewPlanBranchError(null);
        }
        return;
      }

      if (presetCount > 0) {
        if (key.upArrow) {
          setSelectedPresetIndex((prev) =>
            prev > 0 ? prev - 1 : presetCount - 1,
          );
          return;
        }
        if (key.downArrow) {
          setSelectedPresetIndex((prev) =>
            prev < presetCount - 1 ? prev + 1 : 0,
          );
          return;
        }
      }

      if (
        input &&
        !key.ctrl &&
        !key.meta &&
        !key.upArrow &&
        !key.downArrow &&
        !key.leftArrow &&
        !key.rightArrow
      ) {
        setNewPlanBranch((prev) => prev + input);
        if (newPlanBranchError) {
          setNewPlanBranchError(null);
        }
      }

      return;
    }

    if (input === "n" || input === "N") {
      openNewPlanDialog();
      return;
    }

    if (input === "q") {
      exit();
      return;
    }

    // No plans - no navigation
    if (planCount === 0) return;

    if (isInActionMode && expandedPlanId) {
      // In action mode - navigate between actions
      if (key.leftArrow) {
        setSelectedActionIndex((prev) =>
          prev > 0 ? prev - 1 : availableActions.length - 1,
        );
      } else if (key.rightArrow) {
        setSelectedActionIndex((prev) =>
          prev < availableActions.length - 1 ? prev + 1 : 0,
        );
      } else if (key.upArrow) {
        // Go back to plan selection (collapse)
        setIsInActionMode(false);
        setExpandedPlanId(null);
        setSelectedActionIndex(0);
      } else if (input === " ") {
        // Execute the selected action
        const action = availableActions[selectedActionIndex];
        if (action && expandedPlanId) {
          executeAction(action, expandedPlanId);
        }
      }
    } else {
      // In plan selection mode
      if (key.upArrow) {
        setSelectedPlanIndex((prev) => (prev > 0 ? prev - 1 : planCount - 1));
        // If moving to a different plan while one is expanded, collapse it
        if (expandedPlanId) {
          setExpandedPlanId(null);
          setSelectedActionIndex(0);
        }
      } else if (key.downArrow) {
        setSelectedPlanIndex((prev) => (prev < planCount - 1 ? prev + 1 : 0));
        // If moving to a different plan while one is expanded, collapse it
        if (expandedPlanId) {
          setExpandedPlanId(null);
          setSelectedActionIndex(0);
        }
      } else if (input === " ") {
        // Space - toggle expand/collapse
        const planId = allPlanIds[selectedPlanIndex];
        if (planId) {
          if (expandedPlanId === planId) {
            // Already expanded - collapse
            setExpandedPlanId(null);
            setIsInActionMode(false);
            setSelectedActionIndex(0);
          } else {
            // Expand and enter action mode
            setExpandedPlanId(planId);
            setIsInActionMode(true);
            setSelectedActionIndex(0);
          }
        }
      }
    }
  });

  // Update state when dispatcher emits updates
  useEffect(() => {
    const handleUpdate = (newState: DispatcherUIState) => {
      setUIState(newState);

      // Calculate TODO progress for each plan
      const newPlanTodos = new Map<string, { done: number; total: number }>();
      for (const [planId, ps] of Object.entries(newState.state.plans)) {
        // Defensive: skip plans with missing worktree or planRelpath
        if (!ps || !ps.worktree || !ps.planRelpath) {
          newPlanTodos.set(planId, { done: 0, total: 0 });
          continue;
        }
        const planPath = join(ps.worktree, ps.planRelpath);
        if (existsSync(planPath)) {
          try {
            const plan = parsePlan(planPath);
            const done = plan.todos.filter((t) => t.done).length;
            newPlanTodos.set(planId, { done, total: plan.todos.length });
          } catch {
            newPlanTodos.set(planId, { done: 0, total: 0 });
          }
        }
      }
      setPlanTodos(newPlanTodos);
    };

    dispatcherEvents.on("update", handleUpdate);
    return () => {
      dispatcherEvents.off("update", handleUpdate);
    };
  }, []);

  // Keep selected index in bounds when plans change
  useEffect(() => {
    if (selectedPlanIndex >= planCount && planCount > 0) {
      setSelectedPlanIndex(planCount - 1);
    }
    // If expanded plan no longer exists, collapse
    if (expandedPlanId && !allPlanIds.includes(expandedPlanId)) {
      setExpandedPlanId(null);
      setIsInActionMode(false);
      setSelectedActionIndex(0);
    }
  }, [allPlanIds, planCount, selectedPlanIndex, expandedPlanId]);

  // Periodic refresh to update uptime (forces re-render for timer)
  useEffect(() => {
    const interval = setInterval(() => {
      // Just trigger a re-render for uptime display
      // State updates come from dispatcher events, not polling disk
      setUIState((prev) => ({ ...prev }));
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <App
      uiState={uiState}
      planTodos={planTodos}
      selectedPlanIndex={selectedPlanIndex}
      expandedPlanId={expandedPlanId}
      selectedActionIndex={selectedActionIndex}
      isInActionMode={isInActionMode}
      isCreatingPlan={isCreatingPlan}
      newPlanBranch={newPlanBranch}
      newPlanBranchError={newPlanBranchError}
      newPlanPresets={newPlanPresets}
      selectedPresetIndex={selectedPresetIndex}
    />
  );
}

export async function renderTUI(
  repoRoot: string,
  options: RenderTUIOptions = {},
): Promise<void> {
  dispatcherEvents.start();

  // Initialize with current state
  const initialState = loadState(repoRoot);
  dispatcherEvents.setState(initialState);

  const renderOptions: {
    stdin?: NodeJS.ReadStream;
    stdout?: NodeJS.WriteStream;
  } = {};
  if (options.stdin) {
    renderOptions.stdin = options.stdin;
  }
  if (options.stdout) {
    renderOptions.stdout = options.stdout;
  }

  const { waitUntilExit } = render(
    <TUIRunner repoRoot={repoRoot} spawnPlan={options.spawnPlan} />,
    renderOptions,
  );

  await waitUntilExit();
}
