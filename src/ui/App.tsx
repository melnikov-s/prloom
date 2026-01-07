import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { DispatcherUIState, DispatcherEvent } from "../lib/events.js";
import type { PlanState } from "../lib/state.js";

interface HeaderProps {
  startedAt: Date;
}

function formatUptime(startedAt: Date): string {
  const ms = Date.now() - startedAt.getTime();
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);

  if (hours > 0) {
    return `${hours}h ${mins % 60}m`;
  }
  if (mins > 0) {
    return `${mins}m ${secs % 60}s`;
  }
  return `${secs}s`;
}

export function Header({ startedAt }: HeaderProps): React.ReactElement {
  return (
    <Box borderStyle="single" borderColor="cyan" paddingX={1}>
      <Box flexGrow={1}>
        <Text bold color="cyan">
          PRLOOM DASHBOARD
        </Text>
      </Box>
      <Box>
        <Text dimColor>Running: {formatUptime(startedAt)}</Text>
        <Text dimColor> | </Text>
        <Text dimColor>(arrows to navigate, space to expand, q to quit)</Text>
      </Box>
    </Box>
  );
}

interface PlanRowProps {
  id: string;
  branch: string;
  status: string;
  pr?: number;
  repoUrl?: string;
  todosDone: number;
  todosTotal: number;
  error?: string;
}

function getStatusColor(status: string): string {
  switch (status) {
    case "active":
      return "green";
    case "queued":
      return "yellow";
    case "draft":
      return "yellowBright";
    case "blocked":
      return "red";
    case "review":
      return "cyan";
    case "reviewing":
      return "magenta";
    case "done":
      return "gray";
    default:
      return "white";
  }
}

function getStatusEmoji(status: string): string {
  switch (status) {
    case "active":
      return "🟢";
    case "queued":
      return "🟡";
    case "draft":
      return "📝";
    case "blocked":
      return "🔴";
    case "review":
      return "👀";
    case "reviewing":
      return "🔍";
    case "done":
      return "✅";
    default:
      return "⚪";
  }
}

function ProgressBar({
  done,
  total,
}: {
  done: number;
  total: number;
}): React.ReactElement {
  const width = 6;
  const filled = total > 0 ? Math.round((done / total) * width) : 0;
  const empty = width - filled;

  return (
    <Text>
      <Text color="green">{"█".repeat(filled)}</Text>
      <Text dimColor>{"░".repeat(empty)}</Text>
      <Text dimColor>
        {" "}
        {done}/{total}
      </Text>
    </Text>
  );
}

// Column widths for alignment
const COL_ID = 10;
const COL_BRANCH = 28;
const COL_STATUS = 12;
const COL_PROGRESS = 14;

interface SelectablePlanRowProps extends PlanRowProps {
  isSelected: boolean;
}

function SelectablePlanRow({
  id,
  branch,
  status,
  pr,
  repoUrl,
  todosDone,
  todosTotal,
  error,
  isSelected,
}: SelectablePlanRowProps): React.ReactElement {
  const statusColor = getStatusColor(status);
  const statusEmoji = getStatusEmoji(status);
  const prUrl = pr && repoUrl ? `${repoUrl}/pull/${pr}` : pr ? `#${pr}` : "—";

  return (
    <Box>
      <Box width={3}>
        <Text color={isSelected ? "cyan" : undefined}>
          {isSelected ? "▸ " : "  "}
        </Text>
      </Box>
      <Box width={COL_ID}>
        <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
          {id.slice(0, COL_ID - 2)}
        </Text>
      </Box>
      <Box width={COL_BRANCH}>
        <Text dimColor={!isSelected} color={isSelected ? "cyan" : undefined}>
          {branch.slice(0, COL_BRANCH - 2)}
        </Text>
      </Box>
      <Box width={COL_STATUS}>
        <Text>
          {statusEmoji}{" "}
          <Text color={statusColor}>{status.slice(0, 7).padEnd(7)}</Text>
        </Text>
      </Box>
      <Box width={COL_PROGRESS}>
        <ProgressBar done={todosDone} total={todosTotal} />
      </Box>
      <Box>
        <Text dimColor={!isSelected}>{prUrl}</Text>
      </Box>
      {error && (
        <Box marginLeft={1}>
          <Text color="red">{error.slice(0, 20)}</Text>
        </Box>
      )}
    </Box>
  );
}

function PlanHeader(): React.ReactElement {
  return (
    <Box>
      <Box width={3}>
        <Text> </Text>
      </Box>
      <Box width={COL_ID}>
        <Text bold dimColor>
          ID
        </Text>
      </Box>
      <Box width={COL_BRANCH}>
        <Text bold dimColor>
          BRANCH
        </Text>
      </Box>
      <Box width={COL_STATUS}>
        <Text bold dimColor>
          STATUS
        </Text>
      </Box>
      <Box width={COL_PROGRESS}>
        <Text bold dimColor>
          PROGRESS
        </Text>
      </Box>
      <Box>
        <Text bold dimColor>
          PR
        </Text>
      </Box>
    </Box>
  );
}

// Action button definitions
interface ActionDef {
  label: string;
  key: string;
  ipcType?: "stop" | "unpause" | "poll" | "launch_poll" | "review" | "activate";
  command?: string;
  showFor?: (status: string) => boolean;
}

const ACTIONS: ActionDef[] = [
  {
    label: "Activate",
    key: "activate",
    ipcType: "activate",
    showFor: (status) => status === "draft",
  },
  {
    label: "Block",
    key: "block",
    ipcType: "stop",
    showFor: (status) =>
      status !== "blocked" &&
      status !== "done" &&
      status !== "reviewing" &&
      status !== "draft" &&
      status !== "queued",
  },
  {
    label: "Unblock",
    key: "unblock",
    ipcType: "unpause",
    showFor: (status) => status === "blocked",
  },
  {
    label: "Review",
    key: "review",
    ipcType: "review",
    showFor: (status) => status === "review",
  },
  {
    label: "Refresh PR",
    key: "poll",
    ipcType: "poll",
    showFor: (status) =>
      status !== "reviewing" && status !== "draft" && status !== "queued",
  },
];

interface ActionButtonProps {
  label: string;
  isSelected: boolean;
}

function ActionButton({
  label,
  isSelected,
}: ActionButtonProps): React.ReactElement {
  return (
    <Box marginRight={1}>
      <Text
        color={isSelected ? "black" : "white"}
        backgroundColor={isSelected ? "cyan" : undefined}
        bold={isSelected}
      >
        {isSelected ? ` ${label} ` : `[${label}]`}
      </Text>
    </Box>
  );
}

interface LogStreamProps {
  planId: string;
  maxLines?: number;
}

function LogStream({
  planId,
  maxLines = 10,
}: LogStreamProps): React.ReactElement {
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    const logPath = join("/tmp", `prloom-${planId}`, "worker.log");

    const readLogs = () => {
      if (existsSync(logPath)) {
        try {
          const content = readFileSync(logPath, "utf-8");
          const allLines = content.trim().split("\n");
          setLines(allLines.slice(-maxLines));
        } catch {
          setLines(["(error reading log file)"]);
        }
      } else {
        setLines(["(no log file yet)"]);
      }
    };

    readLogs();
    const interval = setInterval(readLogs, 1000);
    return () => clearInterval(interval);
  }, [planId, maxLines]);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold dimColor>
        LOG (last {maxLines} lines):
      </Text>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
        marginTop={1}
      >
        {lines.length === 0 ? (
          <Text dimColor>(empty)</Text>
        ) : (
          lines.map((line, idx) => (
            <Text key={idx} dimColor wrap="truncate">
              {line.slice(0, 100)}
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
}

interface ExpandedPlanViewProps {
  planId: string;
  status: string;
  selectedActionIndex: number;
  availableActions: ActionDef[];
}

function ExpandedPlanView({
  planId,
  status,
  selectedActionIndex,
  availableActions,
}: ExpandedPlanViewProps): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      marginLeft={3}
      marginY={1}
    >
      <LogStream planId={planId} />
      <Box paddingX={1} marginTop={1}>
        <Text bold dimColor>
          ACTIONS:{" "}
        </Text>
        {availableActions.map((action, idx) => (
          <ActionButton
            key={action.key}
            label={action.label}
            isSelected={idx === selectedActionIndex}
          />
        ))}
      </Box>
      <Box paddingX={1} marginTop={1}>
        <Text dimColor>
          (space to execute, up to select plan, left/right for actions)
        </Text>
      </Box>
    </Box>
  );
}

interface InteractivePlanPanelProps {
  uiState: DispatcherUIState;
  planTodos: Map<string, { done: number; total: number }>;
  selectedPlanIndex: number;
  expandedPlanId: string | null;
  selectedActionIndex: number;
  isInActionMode: boolean;
}

export function InteractivePlanPanel({
  uiState,
  planTodos,
  selectedPlanIndex,
  expandedPlanId,
  selectedActionIndex,
  isInActionMode,
}: InteractivePlanPanelProps): React.ReactElement {
  // Combine inbox and active plans
  const inboxEntries = Object.entries(uiState.state.inbox).map(
    ([id, meta]) => ({
      id,
      type: "inbox" as const,
      status: meta.status,
      branch: id,
      pr: undefined as number | undefined,
    })
  );

  const activeEntries = Object.entries(uiState.state.plans).map(([id, ps]) => ({
    id,
    type: "active" as const,
    status: ps.status,
    branch: ps.branch,
    pr: ps.pr,
    ps,
  }));

  const allPlans = [...inboxEntries, ...activeEntries];
  const planCount = allPlans.length;

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="single" paddingX={1}>
      <Box>
        <Text bold>PLANS</Text>
        <Text dimColor> [{planCount}]</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {allPlans.length === 0 ? (
          <Text dimColor>(no plans)</Text>
        ) : (
          <>
            <Box marginBottom={1}>
              <PlanHeader />
            </Box>
            {allPlans.map((plan, idx) => {
              const todos = planTodos.get(plan.id) ?? { done: 0, total: 0 };
              const isSelected = idx === selectedPlanIndex && !isInActionMode;
              const isExpanded = plan.id === expandedPlanId;
              const status = plan.status;
              const ps =
                plan.type === "active"
                  ? uiState.state.plans[plan.id]
                  : undefined;

              // Get available actions for this plan's status
              const availableActions = ACTIONS.filter(
                (a) => !a.showFor || a.showFor(status)
              );

              return (
                <React.Fragment key={plan.id}>
                  <SelectablePlanRow
                    id={plan.id}
                    branch={plan.branch}
                    status={status}
                    pr={plan.pr}
                    repoUrl={uiState.repoUrl}
                    todosDone={todos.done}
                    todosTotal={todos.total}
                    error={ps?.lastError}
                    isSelected={isSelected || isExpanded}
                  />
                  {isExpanded && (
                    <ExpandedPlanView
                      planId={plan.id}
                      status={status}
                      selectedActionIndex={selectedActionIndex}
                      availableActions={availableActions}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </>
        )}
      </Box>
    </Box>
  );
}

interface ActivityPanelProps {
  events: DispatcherEvent[];
}

function getEventPrefix(type: DispatcherEvent["type"]): string {
  switch (type) {
    case "success":
      return "✓";
    case "warning":
      return "⚠";
    case "error":
      return "❌";
    default:
      return "•";
  }
}

function getEventColor(type: DispatcherEvent["type"]): string {
  switch (type) {
    case "success":
      return "green";
    case "warning":
      return "yellow";
    case "error":
      return "red";
    default:
      return "white";
  }
}

export function ActivityPanel({
  events,
}: ActivityPanelProps): React.ReactElement {
  // Show all events with newest at bottom
  const displayEvents = [...events].reverse();

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
    >
      <Text bold>ACTIVITY LOG</Text>
      <Box marginTop={1} flexDirection="column">
        {displayEvents.length === 0 ? (
          <Text dimColor>(no activity yet)</Text>
        ) : (
          displayEvents.map((event, idx) => {
            const time = event.timestamp.toLocaleTimeString("en-US", {
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
            });
            const prefix = getEventPrefix(event.type);
            const color = getEventColor(event.type);

            return (
              <Box key={idx}>
                <Text dimColor>{time}</Text>
                <Text> </Text>
                <Text color={color}>{prefix}</Text>
                <Text> {event.message}</Text>
              </Box>
            );
          })
        )}
      </Box>
    </Box>
  );
}

// Export the action definitions and helper to get available actions
export { ACTIONS };
export type { ActionDef };

export function getAvailableActions(status: string): ActionDef[] {
  return ACTIONS.filter((a) => !a.showFor || a.showFor(status));
}

interface AppProps {
  uiState: DispatcherUIState;
  planTodos: Map<string, { done: number; total: number }>;
  selectedPlanIndex: number;
  expandedPlanId: string | null;
  selectedActionIndex: number;
  isInActionMode: boolean;
}

export function App({
  uiState,
  planTodos,
  selectedPlanIndex,
  expandedPlanId,
  selectedActionIndex,
  isInActionMode,
}: AppProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box flexDirection="column">
        <ActivityPanel events={uiState.events} />
        <InteractivePlanPanel
          uiState={uiState}
          planTodos={planTodos}
          selectedPlanIndex={selectedPlanIndex}
          expandedPlanId={expandedPlanId}
          selectedActionIndex={selectedActionIndex}
          isInActionMode={isInActionMode}
        />
      </Box>
      <Header startedAt={uiState.startedAt} />
    </Box>
  );
}
