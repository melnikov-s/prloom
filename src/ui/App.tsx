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
  status: string;
  pr?: number;
  todosDone: number;
  todosTotal: number;
  error?: string;
  selected?: boolean;
}

function getStatusColor(status: string): string {
  switch (status) {
    case "active":
      return "green";
    case "queued":
      return "yellow";
    case "blocked":
      return "red";
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

function PlanRow({
  id,
  status,
  pr,
  todosDone,
  todosTotal,
  error,
  selected,
}: PlanRowProps): React.ReactElement {
  const indicator = selected ? "▸" : " ";
  const statusColor = getStatusColor(status);
  const statusEmoji = getStatusEmoji(status);

  return (
    <Box>
      <Text>{indicator} </Text>
      <Box width={16}>
        <Text>{id.slice(0, 14)}</Text>
      </Box>
      <Box width={12}>
        <Text>
          {statusEmoji}{" "}
          <Text color={statusColor}>{status.slice(0, 7).padEnd(7)}</Text>
        </Text>
      </Box>
      <Box width={8}>
        <Text dimColor>{pr ? `#${pr}` : "—"}</Text>
      </Box>
      <Box width={14}>
        <ProgressBar done={todosDone} total={todosTotal} />
      </Box>
      {error && (
        <Box>
          <Text color="red">{error.slice(0, 20)}</Text>
        </Box>
      )}
    </Box>
  );
}

interface PlanPanelProps {
  uiState: DispatcherUIState;
  selectedIndex: number;
  planTodos: Map<string, { done: number; total: number }>;
}

export function PlanPanel({
  uiState,
  selectedIndex,
  planTodos,
}: PlanPanelProps): React.ReactElement {
  const planIds = Object.keys(uiState.state.plans);
  const planCount = planIds.length;

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="single" paddingX={1}>
      <Box>
        <Text bold>PLANS</Text>
        <Text dimColor>
          {" "}
          [{selectedIndex + 1}/{planCount}]
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {planIds.length === 0 ? (
          <Text dimColor>(no active plans)</Text>
        ) : (
          planIds.map((planId, idx) => {
            const ps = uiState.state.plans[planId]!;
            const todos = planTodos.get(planId) ?? { done: 0, total: 0 };
            // We'll need to read the plan status from somewhere
            // For now, use a placeholder
            return (
              <PlanRow
                key={planId}
                id={planId}
                status="active"
                pr={ps.pr}
                todosDone={todos.done}
                todosTotal={todos.total}
                error={ps.lastError}
                selected={idx === selectedIndex}
              />
            );
          })
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
  maxLines = 20,
}: ActivityPanelProps): React.ReactElement {
  const displayEvents = events.slice(0, maxLines);

  return (
    <Box
      flexDirection="column"
      width={40}
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
              <Text key={idx} wrap="truncate">
                <Text dimColor>{time}</Text>
                <Text> </Text>
                <Text color={color}>{prefix}</Text>
                <Text> {event.message.slice(0, 25)}</Text>
              </Text>
            );
          })
        )}
      </Box>
    </Box>
  );
}

interface AppProps {
  uiState: DispatcherUIState;
  planTodos: Map<string, { done: number; total: number }>;
}

export function App({ uiState, planTodos }: AppProps): React.ReactElement {
  const [selectedIndex] = React.useState(0);

  return (
    <Box flexDirection="column">
      <Header startedAt={uiState.startedAt} />
      <Box>
        <PlanPanel
          uiState={uiState}
          selectedIndex={selectedIndex}
          planTodos={planTodos}
        />
        <ActivityPanel events={uiState.events} />
      </Box>
    </Box>
  );
}
