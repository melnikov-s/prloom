import React from "react";
import { render } from "ink";
import { join } from "path";
import { existsSync } from "fs";
import { App } from "./App.js";
import { dispatcherEvents, type DispatcherUIState } from "../lib/events.js";
import { loadState } from "../lib/state.js";
import { parsePlan } from "../lib/plan.js";

interface TUIRunnerProps {
  repoRoot: string;
}

function TUIRunner({ repoRoot }: TUIRunnerProps): React.ReactElement {
  const [uiState, setUIState] = React.useState<DispatcherUIState>(
    dispatcherEvents.getUIState()
  );
  const [planTodos, setPlanTodos] = React.useState<
    Map<string, { done: number; total: number }>
  >(new Map());

  // Update state when dispatcher emits updates
  React.useEffect(() => {
    const handleUpdate = (newState: DispatcherUIState) => {
      setUIState(newState);

      // Calculate TODO progress for each plan
      const newPlanTodos = new Map<string, { done: number; total: number }>();
      for (const [planId, ps] of Object.entries(newState.state.plans)) {
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

  // Periodic refresh to update uptime and poll state file
  React.useEffect(() => {
    const interval = setInterval(() => {
      const state = loadState(repoRoot);
      dispatcherEvents.setState(state);
    }, 1000);

    return () => clearInterval(interval);
  }, [repoRoot]);

  return <App uiState={uiState} planTodos={planTodos} />;
}

export async function renderTUI(repoRoot: string): Promise<void> {
  dispatcherEvents.start();

  // Initialize with current state
  const initialState = loadState(repoRoot);
  dispatcherEvents.setState(initialState);

  const { waitUntilExit } = render(<TUIRunner repoRoot={repoRoot} />);

  // Handle 'q' to quit
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.on("data", (data) => {
    if (data.toString() === "q" || data.toString() === "\x03") {
      process.exit(0);
    }
  });

  await waitUntilExit();
}
