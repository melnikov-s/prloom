import React from "react";
import { Box, Text } from "ink";
import type { DispatcherUIState, DispatcherEvent } from "../lib/events.js";

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
        <Text dimColor> │ </Text>
        <Text dimColor>(q to quit)</Text>
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
    case "blocked":
      return "red";
    case "review":
      return "cyan";
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
    case "blocked":
      return "🔴";
    case "review":
      return "👀";
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

function PlanRow({
  id,
  branch,
  status,
  pr,
  repoUrl,
  todosDone,
  todosTotal,
  error,
}: PlanRowProps): React.ReactElement {
  const statusColor = getStatusColor(status);
  const statusEmoji = getStatusEmoji(status);
  const prUrl = pr && repoUrl ? `${repoUrl}/pull/${pr}` : pr ? `#${pr}` : "—";

  return (
    <Box>
      <Box width={COL_ID}>
        <Text>{id.slice(0, COL_ID - 2)}</Text>
      </Box>
      <Box width={COL_BRANCH}>
        <Text dimColor>{branch.slice(0, COL_BRANCH - 2)}</Text>
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
        <Text dimColor>{prUrl}</Text>
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

interface PlanPanelProps {
  uiState: DispatcherUIState;
  planTodos: Map<string, { done: number; total: number }>;
}

export function PlanPanel({
  uiState,
  planTodos,
}: PlanPanelProps): React.ReactElement {
  const planIds = Object.keys(uiState.state.plans);
  const planCount = planIds.length;

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="single" paddingX={1}>
      <Box>
        <Text bold>PLANS</Text>
        <Text dimColor> [{planCount}]</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {planIds.length === 0 ? (
          <Text dimColor>(no active plans)</Text>
        ) : (
          <>
            <PlanHeader />
            {planIds.map((planId, idx) => {
              const ps = uiState.state.plans[planId]!;
              const todos = planTodos.get(planId) ?? { done: 0, total: 0 };
              return (
                <PlanRow
                  key={planId}
                  id={planId}
                  branch={ps.branch}
                  status={ps.status ?? "active"}
                  pr={ps.pr}
                  repoUrl={uiState.repoUrl}
                  todosDone={todos.done}
                  todosTotal={todos.total}
                  error={ps.lastError}
                />
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
  maxLines?: number;
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
  maxLines = 15,
}: ActivityPanelProps): React.ReactElement {
  // Take last N events and show newest at bottom
  const displayEvents = [...events.slice(0, maxLines)].reverse();

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
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

interface ErrorPanelProps {
  planId: string;
  error: string;
}

function ErrorPanel({ planId, error }: ErrorPanelProps): React.ReactElement {
  const logPath = `/tmp/prloom-${planId}/worker.log`;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="red"
      paddingX={1}
      marginTop={0}
    >
      <Text bold color="red">
        ⚠ ERROR: {planId}
      </Text>
      <Box marginTop={1}>
        <Text wrap="wrap">{error}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Log: {logPath}</Text>
      </Box>
    </Box>
  );
}

interface AppProps {
  uiState: DispatcherUIState;
  planTodos: Map<string, { done: number; total: number }>;
}

export function App({ uiState, planTodos }: AppProps): React.ReactElement {
  // Find plans with errors to display
  const plansWithErrors = Object.entries(uiState.state.plans)
    .filter(([, ps]) => ps.lastError)
    .slice(0, 1); // Show first error only for now

  return (
    <Box flexDirection="column">
      <Header startedAt={uiState.startedAt} />
      <Box flexDirection="column">
        <ActivityPanel events={uiState.events} />
        <PlanPanel uiState={uiState} planTodos={planTodos} />
      </Box>
      {plansWithErrors.map(([planId, ps]) => (
        <ErrorPanel key={planId} planId={planId} error={ps.lastError!} />
      ))}
    </Box>
  );
}
