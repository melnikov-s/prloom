/**
 * Bus Manager
 *
 * Handles JSONL file operations for the event/action bus.
 * See RFC: docs/rfc-file-bus.md
 */

import { join } from "path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
  statSync,
} from "fs";
import type {
  BusRecord,
  Event,
  Action,
  DispatcherBusState,
  BridgeActionState,
  JsonValue,
} from "./types.js";

// =============================================================================
// Constants
// =============================================================================

const BUS_DIR = "prloom/.local/bus";
const EVENTS_FILE = "events.jsonl";
const ACTIONS_FILE = "actions.jsonl";
const STATE_DIR = "state";
const DISPATCHER_STATE_FILE = "dispatcher.json";

// =============================================================================
// Directory Management
// =============================================================================

/**
 * Get the bus directory path for a worktree.
 */
export function getBusDir(worktree: string): string {
  return join(worktree, BUS_DIR);
}

/**
 * Initialize the bus directory structure in a worktree.
 * Creates .local/bus/, .local/bus/state/, events.jsonl, and actions.jsonl.
 */
export function initBusDir(worktree: string): void {
  const busDir = getBusDir(worktree);
  const stateDir = join(busDir, STATE_DIR);

  if (!existsSync(busDir)) {
    mkdirSync(busDir, { recursive: true });
  }
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }

  // Create empty JSONL files if they don't exist
  const eventsPath = join(busDir, EVENTS_FILE);
  const actionsPath = join(busDir, ACTIONS_FILE);

  if (!existsSync(eventsPath)) {
    writeFileSync(eventsPath, "");
  }
  if (!existsSync(actionsPath)) {
    writeFileSync(actionsPath, "");
  }
}

/**
 * Check if a bus directory exists for a worktree.
 */
export function hasBusDir(worktree: string): boolean {
  return existsSync(getBusDir(worktree));
}

// =============================================================================
// Event Operations
// =============================================================================

/**
 * Append an event to events.jsonl.
 */
export function appendEvent(worktree: string, event: Event): void {
  const record: BusRecord = {
    ts: new Date().toISOString(),
    kind: "event",
    schemaVersion: 1,
    data: event,
  };

  const eventsPath = join(getBusDir(worktree), EVENTS_FILE);
  appendFileSync(eventsPath, JSON.stringify(record) + "\n");
}

/**
 * Read events from events.jsonl, optionally starting from a byte offset.
 * Returns events and the new offset.
 *
 * The returned offset points to the end of the last successfully parsed line.
 * This ensures that partial lines (from crashes mid-write) will be re-read
 * when they are completed.
 */
export function readEvents(
  worktree: string,
  sinceOffset: number = 0
): { events: Event[]; newOffset: number } {
  const eventsPath = join(getBusDir(worktree), EVENTS_FILE);

  if (!existsSync(eventsPath)) {
    return { events: [], newOffset: 0 };
  }

  // Read file as Buffer to handle byte offsets correctly
  const buffer = readFileSync(eventsPath);

  if (sinceOffset >= buffer.length) {
    return { events: [], newOffset: sinceOffset };
  }

  // Slice at byte level, then decode to string
  const contentFromOffset = buffer.subarray(sinceOffset).toString("utf-8");

  // Find the position of the last newline to avoid partial lines
  const lastNewlineIdx = contentFromOffset.lastIndexOf("\n");

  // If no newline found, the entire content is a partial line
  if (lastNewlineIdx === -1) {
    return { events: [], newOffset: sinceOffset };
  }

  // Only process complete lines (up to and including the last newline)
  const completeContent = contentFromOffset.slice(0, lastNewlineIdx + 1);
  const lines = completeContent.split("\n").filter((line) => line.trim());

  const events: Event[] = [];
  for (const line of lines) {
    try {
      const record: BusRecord = JSON.parse(line);
      if (record.kind === "event") {
        events.push(record.data as Event);
      }
    } catch {
      // Skip malformed lines
    }
  }

  // Calculate new offset: sinceOffset + bytes of complete content
  // Use Buffer to get correct byte length (handles multi-byte UTF-8 chars)
  const completeContentBytes = Buffer.from(completeContent, "utf-8").length;
  const newOffset = sinceOffset + completeContentBytes;

  return { events, newOffset };
}

/**
 * Read all events from events.jsonl (no offset).
 */
export function readAllEvents(worktree: string): Event[] {
  return readEvents(worktree, 0).events;
}

// =============================================================================
// Action Operations
// =============================================================================

/**
 * Append an action to actions.jsonl.
 */
export function appendAction(worktree: string, action: Action): void {
  const record: BusRecord = {
    ts: new Date().toISOString(),
    kind: "action",
    schemaVersion: 1,
    data: action,
  };

  const actionsPath = join(getBusDir(worktree), ACTIONS_FILE);
  appendFileSync(actionsPath, JSON.stringify(record) + "\n");
}

/**
 * Read actions from actions.jsonl, optionally starting from a byte offset.
 * Returns actions and the new offset.
 *
 * The returned offset points to the end of the last successfully parsed line.
 * This ensures that partial lines (from crashes mid-write) will be re-read
 * when they are completed.
 */
export function readActions(
  worktree: string,
  sinceOffset: number = 0
): { actions: Action[]; newOffset: number } {
  const actionsPath = join(getBusDir(worktree), ACTIONS_FILE);

  if (!existsSync(actionsPath)) {
    return { actions: [], newOffset: 0 };
  }

  // Read file as Buffer to handle byte offsets correctly
  const buffer = readFileSync(actionsPath);

  if (sinceOffset >= buffer.length) {
    return { actions: [], newOffset: sinceOffset };
  }

  // Slice at byte level, then decode to string
  const contentFromOffset = buffer.subarray(sinceOffset).toString("utf-8");

  // Find the position of the last newline to avoid partial lines
  const lastNewlineIdx = contentFromOffset.lastIndexOf("\n");

  // If no newline found, the entire content is a partial line
  if (lastNewlineIdx === -1) {
    return { actions: [], newOffset: sinceOffset };
  }

  // Only process complete lines (up to and including the last newline)
  const completeContent = contentFromOffset.slice(0, lastNewlineIdx + 1);
  const lines = completeContent.split("\n").filter((line) => line.trim());

  const actions: Action[] = [];
  for (const line of lines) {
    try {
      const record: BusRecord = JSON.parse(line);
      if (record.kind === "action") {
        actions.push(record.data as Action);
      }
    } catch {
      // Skip malformed lines
    }
  }

  // Calculate new offset: sinceOffset + bytes of complete content
  // Use Buffer to get correct byte length (handles multi-byte UTF-8 chars)
  const completeContentBytes = Buffer.from(completeContent, "utf-8").length;
  const newOffset = sinceOffset + completeContentBytes;

  return { actions, newOffset };
}

/**
 * Read all actions from actions.jsonl (no offset).
 */
export function readAllActions(worktree: string): Action[] {
  return readActions(worktree, 0).actions;
}

// =============================================================================
// Dispatcher State
// =============================================================================

/**
 * Load dispatcher bus state from state/dispatcher.json.
 */
export function loadDispatcherState(worktree: string): DispatcherBusState {
  const statePath = join(getBusDir(worktree), STATE_DIR, DISPATCHER_STATE_FILE);

  if (!existsSync(statePath)) {
    return {
      eventsOffset: 0,
      actionsOffset: 0,
      processedEventIds: [],
    };
  }

  try {
    const content = readFileSync(statePath, "utf-8");
    return JSON.parse(content) as DispatcherBusState;
  } catch {
    return {
      eventsOffset: 0,
      actionsOffset: 0,
      processedEventIds: [],
    };
  }
}

/**
 * Save dispatcher bus state to state/dispatcher.json.
 */
export function saveDispatcherState(
  worktree: string,
  state: DispatcherBusState
): void {
  const stateDir = join(getBusDir(worktree), STATE_DIR);
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }

  const statePath = join(stateDir, DISPATCHER_STATE_FILE);
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

// =============================================================================
// Bridge State
// =============================================================================

/**
 * Load bridge-specific inbound state (for event cursors).
 */
export function loadBridgeState(
  worktree: string,
  bridgeName: string
): JsonValue | undefined {
  const statePath = join(
    getBusDir(worktree),
    STATE_DIR,
    `bridge.${bridgeName}.json`
  );

  if (!existsSync(statePath)) {
    return undefined;
  }

  try {
    const content = readFileSync(statePath, "utf-8");
    return JSON.parse(content) as JsonValue;
  } catch {
    return undefined;
  }
}

/**
 * Save bridge-specific inbound state.
 */
export function saveBridgeState(
  worktree: string,
  bridgeName: string,
  state: JsonValue
): void {
  const stateDir = join(getBusDir(worktree), STATE_DIR);
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }

  const statePath = join(stateDir, `bridge.${bridgeName}.json`);
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

/**
 * Load bridge action delivery state (for idempotency).
 */
export function loadBridgeActionState(
  worktree: string,
  bridgeName: string
): BridgeActionState {
  const statePath = join(
    getBusDir(worktree),
    STATE_DIR,
    `bridge.${bridgeName}.actions.json`
  );

  if (!existsSync(statePath)) {
    return { deliveredActions: {} };
  }

  try {
    const content = readFileSync(statePath, "utf-8");
    return JSON.parse(content) as BridgeActionState;
  } catch {
    return { deliveredActions: {} };
  }
}

/**
 * Save bridge action delivery state.
 */
export function saveBridgeActionState(
  worktree: string,
  bridgeName: string,
  state: BridgeActionState
): void {
  const stateDir = join(getBusDir(worktree), STATE_DIR);
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }

  const statePath = join(stateDir, `bridge.${bridgeName}.actions.json`);
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

// =============================================================================
// Event Deduplication
// =============================================================================

/**
 * Filter events to only include those not already processed.
 * Updates the processed IDs set in place.
 */
export function deduplicateEvents(
  events: Event[],
  processedIds: Set<string>
): Event[] {
  const newEvents: Event[] = [];

  for (const event of events) {
    if (!processedIds.has(event.id)) {
      processedIds.add(event.id);
      newEvents.push(event);
    }
  }

  return newEvents;
}

/**
 * Limit the size of processed event IDs to prevent unbounded growth.
 * Keeps the most recent N IDs.
 */
export function pruneProcessedIds(
  ids: string[],
  maxSize: number = 1000
): string[] {
  if (ids.length <= maxSize) {
    return ids;
  }
  return ids.slice(ids.length - maxSize);
}
