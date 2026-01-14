# RFC: Global Bridges & Core Bridge

**Status**: Draft
**Created**: 2026-01-13

## Summary

This RFC proposes adding **Global Bridges**, **Global Plugins**, and a built-in **Core Bridge** (`prloom-core`) to the architecture. This enables repository-level automation—such as creating plans from GitHub Issues, syncing plan edits back to issues, and managing the "Inbox"—without requiring userland code to access internal `.local` storage.

Additionally, this RFC introduces a unified event handling model with `onEvent` (plan-scoped) and `onGlobalEvent` (global-scoped) hooks, replacing the existing `beforeTriage` hook.

---

## Alignment with Current Implementation

This section documents how this RFC aligns with and extends the existing codebase.

### Storage Format

**Current implementation** (`src/lib/state.ts`):
- Inbox plans: `prloom/.local/inbox/<id>.md` (content) + optional `<id>.json` (metadata)
- Active plans: `prloom/.local/worktrees/<name>/prloom/.local/state.json` (per-worktree state)
- Plan content in worktree: `<worktree>/prloom/.local/plan.md`

This RFC preserves these locations. The `prloom-core` bridge abstracts over them.

### Status Mapping

**Current statuses** (`PlanState.status`):
| Current | Location | Meaning |
|---------|----------|---------|
| `draft` | Inbox | Plan exists but not queued |
| `queued` | Inbox | Ready for activation |
| `active` | Worktree | Currently executing |
| `triaging` | Worktree | Processing events |
| `review` | Worktree | Awaiting review |
| `done` | Worktree | Completed |

**RFC additions**:

This RFC adds a `hidden` boolean property (not a status) to `PlanState`:

```typescript
export interface PlanState {
  status: "draft" | "queued" | "active" | "review" | "triaging" | "done";
  hidden?: boolean;  // If true, dispatcher ignores this plan
  // ... existing fields
}
```

The `hidden` flag is orthogonal to status—a plan can be `queued` but hidden, meaning it's ready to run but the dispatcher should skip it. This avoids polluting the status state machine with visibility concerns.

### PlanSource: External Identity Tracking

This RFC adds a `source` field to `PlanState` to track the external origin of a plan:

```typescript
interface PlanSource {
  system: string;   // e.g. "github", "jira", "linear"
  kind: string;     // e.g. "issue", "ticket", "card"
  id: string;       // e.g. "123", "PROJ-456"
}

export interface PlanState {
  status: "draft" | "queued" | "active" | "review" | "triaging" | "done";
  hidden?: boolean;
  source?: PlanSource;  // External system identity
  // ... existing fields
}
```

**Storage**:
- Inbox plans: stored in `prloom/.local/inbox/<id>.json` metadata
- Active plans: stored in `<worktree>/prloom/.local/state.json`

**Migration on activation**: When a plan moves from inbox to worktree, `source` is copied to the worktree's `state.json`. The inbox files are deleted.

**Uniqueness**: `prloom-core` enforces source uniqueness. When processing `upsert_plan`:
- If a plan with matching `source` exists (any location), update it
- If no match, create a new plan
- Two plans cannot have the same `source`—the second upsert updates the first

**Optional**: Plans created via CLI or other means may have no `source`. These plans cannot be targeted by `upsert_plan` (which requires `source` for identity resolution).

### Bus Architecture

**Current implementation** (`src/lib/bus/manager.ts:30`):
- Per-worktree bus: `<worktree>/prloom/.local/bus/{events,actions}.jsonl`
- Dispatcher state: `<worktree>/prloom/.local/bus/state/dispatcher.json`
- Bridge state: `<worktree>/prloom/.local/bus/state/bridge.<name>.json`

**This RFC adds**:
- Global bus: `prloom/.local/bus/{events,actions}.jsonl` (repo root)
- Global dispatcher state: `prloom/.local/bus/state/dispatcher.json`
- Global bridge state: `prloom/.local/bus/state/bridge.<name>.json`

The global bus uses identical JSONL format and offset-based reading. Global and plan buses are separate; they do not share event IDs or cursors.

**API generalization**: Current bus APIs accept a `worktree` parameter (e.g., `appendEvent(worktree, ...)`, `loadDispatcherState(worktree)`). To support the global bus, these APIs will be generalized to accept a `scopeRoot` parameter:
- For plan buses: `scopeRoot` = worktree path
- For global bus: `scopeRoot` = repo root

This avoids duplicating bus logic. The `BridgeContext.worktree` field remains unchanged for plan-scoped bridges; global bridges receive `worktree: undefined`.

### Lifecycle Operations on the Bus

**Existing non-goal** (`docs/rfc-file-bus.md:17-18`):
> Lifecycle operations (create PR, mark ready, update description) remain direct dispatcher calls—they are not abstracted through the bus.

**This RFC amends that for plan lifecycle specifically**:
- `upsert_plan` actions flow through the global bus to `prloom-core`
- This enables `beforeUpsert` hooks for validation/transformation
- PR lifecycle (create, mark ready) remains direct dispatcher calls

The rationale: plan creation benefits from the same interception/routing as external actions, but PR operations are tightly coupled to the dispatcher's orchestration.

### OutboundPayload Extension

The `upsert_plan` action requires extending `OutboundPayload` (`src/lib/bus/types.ts:65-81`):

```typescript
export type OutboundPayload =
  | { type: "comment"; message: string }
  // ... existing types ...
  | { type: "upsert_plan"; source: PlanSource; title?: string; planMarkdown?: string; hidden?: boolean };
```

And registering `prloom-core` as a target in the bridge registry.

### Global Event Semantics

**Current plan-scoped semantics** (`src/lib/hooks/types.ts:155-194`):
- `markEventHandled(id)` → adds to `processedEventIds`, event never triaged
- `markEventDeferred(id, reason, retryMs)` → skips for now, retries later
- State persisted in dispatcher.json offsets

**Global semantics (new)**:
- Same API: `markEventHandled(id)`, `markEventDeferred(id, reason, retryMs)`
- State persisted at: `prloom/.local/bus/state/dispatcher.json`
- Deferred events tracked with: `{ deferredEventIds: { [id]: { reason, deferredUntil } } }`

**Offset and delivery semantics**:
- Global bus uses byte-offset cursors like plan buses (`eventsOffset` in dispatcher state)
- Events are delivered to `onGlobalEvent` hooks **once** as the offset advances
- `markEventHandled(id)` adds to `processedEventIds`; the event won't be re-delivered even if deferred events cause re-processing
- `markEventDeferred(id)` keeps the event eligible for re-delivery on subsequent ticks (until `deferredUntil` expires)
- **Unhandled events**: Unlike plan-scoped events (which fall through to triage), unhandled global events simply pass through with no action. The offset still advances—they are not re-delivered.

The key difference from plan-scoped: there is no default handler. If no plugin handles a global event, nothing happens.

### Hash-Based Edit Detection

**File locations for hashing**:
- Inbox plans: `sha256(prloom/.local/inbox/<id>.md)`
- Active plans: `sha256(<worktree>/prloom/.local/plan.md)`

The dispatcher maintains a hash cache in global state:
```typescript
interface GlobalDispatcherState {
  planHashes: Record<string, string>;  // planId → sha256
  // ...
}
```

### Context Method Implementation

`readPlan()` and `listPlans()` use existing primitives:

```typescript
// readPlan implementation sketch
async function readPlan(planId: string): Promise<PlanContent | undefined> {
  const state = loadState(repoRoot);
  const planState = state.plans[planId];
  
  if (!planState) return undefined;
  
  if (planState.worktree) {
    // Active plan
    const path = join(planState.worktree, "prloom/.local/plan.md");
    return { content: readFileSync(path, "utf-8"), progress: parseProgress(...) };
  } else {
    // Inbox plan
    const path = getInboxPath(repoRoot, planId);
    return { content: readFileSync(path, "utf-8"), progress: parseProgress(...) };
  }
}

// listPlans uses loadState() which already scans worktrees + inbox
async function listPlans(filter?: PlanFilter): Promise<PlanSummary[]> {
  const state = loadState(repoRoot);
  return Object.entries(state.plans)
    .filter(([id, ps]) => matchesFilter(ps, filter))
    .map(([id, ps]) => toPlanSummary(id, ps));
}
```

---

## Motivation

Currently, `prloom` automation is strictly **plan-scoped**. Bridges and plugins only run when an active plan (and its dedicated worktree) exists. This creates significant gaps for "Pre-Plan" or "Repository-Level" workflows, specifically:

1.  **Kanban Intake**: Automatically creating plans in the Inbox when a GitHub Issue is moved to a "Todo" column.
2.  **Two-Way Sync**: Syncing changes from a GitHub Issue to a Plan (Inbox or Active) and vice-versa.
3.  **Inbox Management**: Managing pending plans programmatically without "peeking" into unstable `.local` file formats.

To support these workflows cleanly, we need a way to run logic *outside* of active plans and a stable primitive for manipulating the Plan lifecycle.

---

## Architecture Changes

### 1. Global Dispatcher Tick & Bus

The Dispatcher will implement a **Global Tick** that runs once per iteration, alongside the existing per-plan ticks.

-   **Scope**: Runs at the repo root level.
-   **Storage**: Uses a repository-level bus log: `prloom/.local/bus/events.jsonl` (and `actions.jsonl`).
-   **Runs**: Before per-plan ticks, every dispatcher iteration.

### 2. Global Bridges Configuration

Bridges that operate at the repository level (not tied to a specific plan) are configured separately.

-   **Config Key**: `globalBridges`
-   **Behavior**: Loaded once at Dispatcher startup. Run during the Global Tick.

```json
{
  "globalBridges": {
    "kanban": {
      "module": "./bridges/github-kanban.js",
      "config": {
        "projectId": "PVT_abc123",
        "todoColumn": "Ready"
      }
    }
  },
  "bridges": {
    "github": { "enabled": true }
  }
}
```

**Loader conventions** (same as plan-scoped `bridges`):
- `module`: Relative paths (starting with `./`) resolve from repo root. Package names resolve via Node resolution.
- `enabled`: Optional boolean, defaults to `true`. Set to `false` to disable without removing config.
- `config`: Freeform object passed to the bridge via `ctx.config`.

**Registry and target uniqueness**:
- Global and plan-scoped bridges share a **single target registry**.
- Target names must be globally unique across both `globalBridges` and `bridges`.
- If two bridges claim the same target, the dispatcher fails at startup with an error.
- This ensures actions can be routed unambiguously regardless of scope.

### 3. The Core Bridge (`prloom-core`)

A built-in **outbound-only** bridge available in the Global scope. It handles `upsert_plan` actions but does not poll external systems.

-   **Target**: `prloom-core`
-   **Responsibilities**:
    -   Handling `upsert_plan` actions.
    -   Resolving "Source Identity" (e.g., `issue:123`) to a concrete plan location (Inbox vs. Worktree).
    -   Managing the file system operations for creating/updating plans.

**Note**: `prloom-core` is an outbound-only bridge—it has no `events()` method. Lifecycle events (`plan_created`, `plan_edited`, etc.) are emitted by **dispatcher tick logic**, not by the bridge. The dispatcher detects changes (via hash comparison, status transitions, file deletions) and writes events to the global bus directly.

### 4. Plan Lifecycle Events (Global Bus)

The **dispatcher** emits events to the **Global Bus** when plan state changes. These events are only visible to global plugins via `onGlobalEvent`:

| Event | When | Context |
|-------|------|---------|
| `plan_created` | New plan appears in inbox or worktree | `{ planId, location, source }` |
| `plan_edited` | Existing plan content changes | `{ planId, location, source, oldHash, newHash }` |
| `plan_status_changed` | Plan moves between states | `{ planId, oldStatus, newStatus }` |
| `plan_deleted` | Plan is removed from inbox or worktree | `{ planId, location, source, reason }` |

**Detection Mechanism**: Hash-based. The Dispatcher computes hashes during every tick:
- Inbox plans: `sha256(prloom/.local/inbox/<id>.md)`
- Active plans: `sha256(<worktree>/prloom/.local/plan.md)`

Hashes are cached in `prloom/.local/bus/state/dispatcher.json`.

### 5. Bridge Context Extensions

### 5. Context Extensions for Plans

To support reading and querying plans without knowing their physical location, we extend **multiple context types**:

| Method | `BridgeContext` | `GlobalEventContext` | `OnEventContext` |
|--------|-----------------|----------------------|------------------|
| `readPlan(planId?)` | Yes (required `planId`) | Yes (required `planId`) | Yes (optional `planId`) |
| `listPlans(filter?)` | Yes | Yes | No |

**Where each context is used**:
- `BridgeContext`: Passed to bridge `events()` and `actions()` methods
- `GlobalEventContext`: Passed to `onGlobalEvent` hooks in global plugins
- `OnEventContext`: Passed to `onEvent` hooks in plan plugins

**Method signatures**:

-   `readPlan(planId?: string): Promise<{ content: string; progress: { total: number; completed: number } } | undefined>`
    -   **Global contexts**: Must provide `planId`. Resolves location by scanning worktrees and inbox (via `loadState()`).
    -   **Plan context**: If `planId` omitted, returns the current plan's content.
    -   **Returns**: The raw content plus parsed progress metrics (total/completed TODOs).

-   `listPlans(filter?: PlanFilter): Promise<PlanSummary[]>`
    -   **Global contexts only**: Not available in plan-scoped `OnEventContext`.
    -   **Returns**: Array of plan summaries matching the filter criteria.

```typescript
// Status is the actual PlanState.status; hidden is a separate boolean
type PlanStatus = "draft" | "queued" | "active" | "triaging" | "review" | "done";

interface PlanFilter {
  status?: PlanStatus | PlanStatus[];
  hidden?: boolean;  // Filter by hidden flag
  source?: {
    system?: string;  // e.g. "github"
    kind?: string;    // e.g. "issue"
    id?: string;      // e.g. "123"
  };
  location?: "inbox" | "worktree";
}

interface PlanSummary {
  planId: string;
  title: string;
  status: PlanStatus;
  hidden: boolean;
  location: "inbox" | "worktree";
  source?: { system: string; kind: string; id: string };
  progress: { total: number; completed: number };
  createdAt: string;
  updatedAt: string;
}
```

**Use Cases**:
- **Duplicate Detection**: Before creating a plan, check if one already exists for the same source.
- **Dashboard/Reporting**: List all active plans with their progress.
- **Cleanup Workflows**: Find orphaned or stale plans.

### 6. Global Plugins Configuration

To avoid ambiguity between Plan Lifecycle (Presets) and Global Lifecycle, we introduce a distinct configuration section for Global Plugins.

-   **Config Key**: `globalPlugins`
-   **Behavior**:
    -   Loaded once at Dispatcher startup.
    -   **Cannot** be overridden or disabled by Presets.
    -   Can only use **Global Hooks**.
-   **Existing `plugins` key**: Remains strictly for Plan-Scoped plugins (Plan Hooks only).

```json
{
  "globalPlugins": {
    "kanbanIntake": { "module": "my-kanban", "config": { ... } }
  },
  "plugins": {
    "mergeCommand": { "module": "my-kanban", "config": { ... } }
  }
}
```

A single module can export both global and plan hooks. The dispatcher uses the appropriate hooks based on where the plugin is registered.

### 7. Global Hook Points

Global Plugins can use these hooks:

| Hook | When | Use Case |
|------|------|----------|
| `onStartup` | Dispatcher starts | Initialize shared resources (DB, cache) |
| `onGlobalEvent` | Event appears on global bus | React to `plan_created`, `plan_edited`, etc. |
| `beforeRoute` | Before actions are routed to bridges | Intercept/block/redirect actions |
| `beforeUpsert` | Before `prloom-core` writes a plan | Transform content, validate, reject |
| `afterActivate` | After a plan moves from inbox to worktree | Setup environment (inject secrets) |

### 8. Plan Hook Points

Plan Plugins can use these hooks:

| Hook | When | Use Case |
|------|------|----------|
| `onEvent` | Event appears on plan's bus | Handle `/merge` commands, custom triggers |
| `afterDesign` | After designer creates plan | Validation, custom sections |
| `beforeTodo` | Before starting a TODO | Pre-checks, setup |
| `afterTodo` | After completing a TODO | Run tests, lint |
| `beforeFinish` | Before marking plan ready | Review council, final checks |
| `afterFinish` | After plan is marked ready | Notifications, cleanup |

**Note**: `onEvent` replaces the previous `beforeTriage` concept. Unhandled events flow to the triage agent as before.

---

## Detailed Design

### Event Handling Hooks

Both scopes have event handling, with distinct hook names to avoid collision:

**Global Plugin (`onGlobalEvent`)**:
```ts
export default function kanbanSync(config) {
  return {
    onGlobalEvent: async (event, ctx) => {
      if (event.type === "plan_created") {
        const plan = await ctx.readPlan(event.context.planId);
        await syncToGitHub(event.context.source, plan.content);
        ctx.markEventHandled(event.id);
      }
    }
  };
}
```

**Plan Plugin (`onEvent`)**:
```ts
export default function mergeCommand(config) {
  return {
    onEvent: async (event, ctx) => {
      if (event.body.startsWith("/merge")) {
        ctx.markEventHandled(event.id);
        ctx.emitMerge(event.replyTo, "squash");
      }
    }
  };
}
```

**Shared Module (both hooks)**:
```ts
export default function kanbanPlugin(config) {
  return {
    // Registered via globalPlugins
    onGlobalEvent: async (event, ctx) => {
      if (event.type === "plan_edited") {
        const plan = await ctx.readPlan(event.context.planId);
        await updateGitHubIssue(event.context.source.id, plan.content);
      }
    },

    // Registered via plugins
    onEvent: async (event, ctx) => {
      if (event.body.startsWith("/sync")) {
        ctx.markEventHandled(event.id);
        // Force sync...
      }
    }
  };
}
```

### Event Handler Context

| Property/Method | `onEvent` (Plan) | `onGlobalEvent` (Global) |
|-----------------|------------------|--------------------------|
| `event` | Current event | Current event |
| `markEventHandled(id)` | Yes | Yes |
| `markEventDeferred(id, reason?, retryMs?)` | Yes | Yes |
| `emitAction()` | Yes | Yes |
| `emitComment()`, `emitMerge()`, etc. | Yes | Yes |
| `readPlan(planId?)` | Optional `planId` | Required `planId` |
| `listPlans(filter?)` | No | Yes |
| `worktree` | Current plan's worktree | `undefined` |
| `planId` | Current plan | `undefined` |
| `repoRoot` | Yes | Yes |
| `getState()` / `setState()` | Per-plan state | Global state |

### Event Flow

**Plan-scoped**:
```
plan bus events → onEvent hooks → unhandled events → triage agent → TODOs
```

**Global-scoped**:
```
global bus events → onGlobalEvent hooks → (no default handler)
```

Unhandled global events remain in the log but have no default processing.

**Invocation semantics**: Both `onEvent` and `onGlobalEvent` are invoked **once per event**, not once per batch. The runner iterates over new events and calls each registered hook for each event:

```typescript
// Pseudocode for event processing
for (const event of newEvents) {
  for (const plugin of plugins) {
    if (plugin.onEvent) {
      await plugin.onEvent(event, ctx);
    }
  }
  if (!ctx.isHandled(event.id) && !ctx.isDeferred(event.id)) {
    // Event flows to triage (plan-scoped only)
    eventsForTriage.push(event);
  }
}
```

This differs from the previous `beforeTriage` model where hooks received the entire `ctx.events` array and iterated internally.

### Action Interception (`beforeRoute`)

Global Plugins can intercept actions before they reach bridges:

```ts
export default function policyEnforcer(config) {
  return {
    beforeRoute: async (action, ctx) => {
      // Block merges on Fridays
      if (action.payload.type === "merge" && isFriday()) {
        ctx.markActionHandled(action.id);
        ctx.emitComment(action.target, "Merges are blocked on Fridays.");
        return;
      }
    }
  };
}
```

**Semantics**:
- `ctx.markActionHandled(id)` → Action is not delivered to the target bridge.
- If hook throws → Action is **not delivered**. Error is logged. Action remains in queue for retry.

**Implementation**:

Action interception uses a `processedActionIds` set in global dispatcher state (analogous to `processedEventIds` for events):

```typescript
interface GlobalDispatcherState {
  actionsOffset: number;
  processedActionIds: string[];  // Actions marked as handled by plugins
  // ... other fields
}
```

**Delivery flow**:
1. Read actions from `actions.jsonl` starting at `actionsOffset`
2. For each action not in `processedActionIds`:
   a. Run `beforeRoute` hooks in order
   b. If any hook calls `markActionHandled(id)`, add to `processedActionIds`
   c. If not handled, route to target bridge
3. Advance `actionsOffset` regardless of handled status

**Crash recovery**: If a plugin crashes after calling `markActionHandled` but before state is persisted, the action may be redelivered on restart. This is at-least-once semantics, consistent with bridge delivery. Plugins and bridges should be idempotent by `Action.id`.

### Plan Content Interception (`beforeUpsert`)

Global Plugins can intercept `upsert_plan` actions before `prloom-core` writes the plan. This enables content transformation, validation, and duplicate detection.

```ts
export default function planValidator(config) {
  return {
    beforeUpsert: async (payload, ctx) => {
      // Reject plans without a title
      if (!payload.title) {
        return { reject: true, reason: "Plan must have a title" };
      }

      // Check for duplicates
      const existing = await ctx.listPlans({
        source: payload.source
      });
      if (existing.length > 0) {
        // Already exists, let prloom-core handle the update
        return { proceed: true };
      }

      // Transform content (e.g., add standard sections)
      return {
        proceed: true,
        payload: {
          ...payload,
          planMarkdown: addStandardSections(payload.planMarkdown)
        }
      };
    }
  };
}
```

**Return Values**:
- `{ proceed: true }` → Continue to `prloom-core` with original payload.
- `{ proceed: true, payload: {...} }` → Continue with transformed payload.
- `{ reject: true, reason: "..." }` → Abort the upsert. Action is marked handled. Reason is logged.

**Semantics**:
- Runs **before** `prloom-core` processes the action.
- Multiple plugins run in order; each receives the (potentially transformed) payload from the previous.
- If any plugin rejects, the chain stops and the action is not processed.

### The `upsert_plan` Action

Bridges emit this action to create or update a plan. They do *not* need to know if the plan is currently in the Inbox or running in a Worktree.

**Target**: `{ "target": "prloom-core" }`

**Payload**:
```typescript
interface UpsertPlanPayload {
  type: "upsert_plan";
  
  // Identity: "If a plan with this source exists, update it. Else create new."
  source: {
    system: string;   // e.g. "github", "jira", "linear"
    kind: string;     // e.g. "issue", "ticket"
    id: string;       // e.g. "123"
  };

  // Content
  title?: string;
  planMarkdown?: string;
  
  // Metadata (optional)
  metadata?: Record<string, unknown>;
  
  // Initial status for new plans (default: "draft")
  status?: "draft" | "queued";
  
  // If true, plan is tracked but ignored by dispatcher activation
  hidden?: boolean;
}
```

**Resolution Logic (performed by `prloom-core`)**:
1.  **Search Active Plans**: Scan `prloom/.local/worktrees/*/prloom/.local/state.json` for a plan matching `source`. If found → **Update `<worktree>/prloom/.local/plan.md`**.
2.  **Search Inbox**: Check `prloom/.local/inbox/*.json` for a plan matching `source`. If found → **Update `prloom/.local/inbox/<id>.md`**.
3.  **Not Found**: **Create new Inbox Plan** (`<id>.md` + `<id>.json`) with specified `status` and `hidden` flag.

### Hidden Plans

Plans can have `hidden: true` in their metadata (inbox `<id>.json` or worktree `state.json`).

-   **Behavior**: Ignored by the Dispatcher's activation loop. No Worktree created, no PR opened.
-   **Purpose**: Allows Bridges to maintain a local representation of an external item (for caching/sync) without triggering execution until explicitly un-hidden.
-   **Orthogonal to status**: A plan can be `{ status: "queued", hidden: true }`—ready to run but skipped by the dispatcher.

---

## Workflow Examples

### Kanban Intake & Sync

**1. Ingest (Issue → Plan)**
1.  User moves Issue #123 to "Todo" column.
2.  `github-kanban` (Global Bridge) polls, sees move.
3.  Bridge emits Action: `upsert_plan(source={system:"github", kind:"issue", id:"123"}, markdown=issue.body)`.
4.  `prloom-core` receives action → Creates Inbox Plan.
5.  `prloom-core` emits `plan_created` event.

**2. Sync Update (Issue → Plan)**
1.  User edits Issue #123 body on GitHub.
2.  `github-kanban` polls, sees change.
3.  Bridge emits Action: `upsert_plan(source={id:"123"}, markdown=newBody)`.
4.  `prloom-core` receives action:
    -   If plan is still in Inbox → Updates Inbox file.
    -   If plan is Active (running) → Updates `plan.md` in Worktree.
5.  `prloom-core` emits `plan_edited` event.

**3. Sync Back (Plan → Issue)**
1.  Agent (or User) modifies `plan.md` during execution.
2.  Global Tick detects hash change → Emits `plan_edited`.
3.  `kanbanSync` global plugin sees `plan_edited` via `onGlobalEvent`.
4.  Plugin calls `ctx.readPlan(planId)` to get content.
5.  Plugin calls GitHub API to update Issue #123 body.

### Merge Command

**Flow**:
1.  User comments `/merge` on PR.
2.  GitHub bridge (plan-scoped) polls, creates event.
3.  `mergeCommand` plugin sees event via `onEvent`.
4.  Plugin calls `ctx.markEventHandled(event.id)` (triage won't see it).
5.  Plugin calls `ctx.emitMerge(event.replyTo, "squash")`.

---

## Plugin Ordering & Error Handling

### Ordering

Hooks run in the order plugins are declared in config:

```json
{
  "globalPlugins": {
    "policyEnforcer": { "module": "..." },
    "kanbanIntake": { "module": "..." }
  }
}
```

`policyEnforcer.beforeRoute` runs before `kanbanIntake.beforeRoute`.

For explicit ordering, use `globalPluginOrder` / `pluginOrder`:

```json
{
  "globalPluginOrder": ["policyEnforcer", "kanbanIntake"],
  "globalPlugins": { ... }
}
```

### Error Handling

-   **Event hooks** (`onEvent`, `onGlobalEvent`): If a hook throws, the event is **not marked handled**. Error is logged. Event remains for retry on next tick.
-   **Action hooks** (`beforeRoute`): If a hook throws, the action is **not delivered**. Error is logged. Action remains in queue for retry.
-   **Upsert hooks** (`beforeUpsert`): If a hook throws, the upsert is **aborted**. Error is logged. Action remains in queue for retry.
-   **Lifecycle hooks** (`afterDesign`, etc.): If a hook throws, the plan is **blocked**. Error is logged. Manual intervention required.

---

## Breaking Changes

### `beforeTriage` Removed

The `beforeTriage` hook (`src/lib/hooks/types.ts:24`) is **removed** and replaced by `onEvent`.

**Rationale**: The name `beforeTriage` implied the hook ran before triage, but its actual purpose was event interception. `onEvent` better describes the semantics and aligns with `onGlobalEvent`.

**Key differences**:

| Aspect | `beforeTriage` (removed) | `onEvent` (new) |
|--------|--------------------------|-----------------|
| Signature | `(plan, ctx) => plan` | `(event, ctx) => void` |
| Event access | `ctx.events` array | Single `event` parameter |
| Iteration | Plugin iterates over events | Runner calls hook per event |
| Return value | Modified plan content | None (side effects only) |

The `onEvent` signature is simpler: you handle one event at a time, and the runner manages iteration. Plan modifications should use dedicated hooks (`afterDesign`, `afterTodo`, etc.).

**Execution model change**:

The existing hook system uses a plan-transform pipeline where hooks are typed as `Hook = (plan: string, ctx: HookContext) => Promise<string>`. This remains unchanged for plan-transforming hooks (`afterDesign`, `beforeTodo`, `afterTodo`, `beforeFinish`, `afterFinish`).

`onEvent` and `onGlobalEvent` are **not** part of the plan-transform pipeline. They are event handlers with a different type:

```typescript
// Plan-transform hooks (existing model)
type Hook = (plan: string, ctx: HookContext) => Promise<string>;

// Event hooks (new model)
type EventHook = (event: Event, ctx: EventContext) => Promise<void>;
```

Plugin modules can export both types. TypeScript discriminates based on the hook name:

```typescript
export default function myPlugin(config) {
  return {
    // Event hook - called once per event
    onEvent: async (event, ctx) => { /* ... */ },
    
    // Plan-transform hook - receives and returns plan string
    afterTodo: async (plan, ctx) => { /* ... */ return plan; },
  };
}
```

**Example**:

```typescript
export default function myPlugin(config) {
  return {
    onEvent: async (event, ctx) => {
      if (event.body.startsWith("/merge")) {
        ctx.markEventHandled(event.id);
        ctx.emitMerge(event.replyTo, "squash");
      }
    }
  };
}
```

### Context Extensions Preserved

The context extensions from `BeforeTriageContext` are available on the new `OnEventContext`:

- `markEventHandled()` / `markEventDeferred()`
- `getState()` / `setState()`
- `getGlobalState()` / `setGlobalState()`
- `emitComment()` / `emitMerge()` / etc.
- `readEvents()`

---

## Extensibility Implication

This architecture cleanly separates concerns:

-   **Userland**: Owns "Policy" (What is a Todo? How to parse Issue body? When to sync?). Encapsulated in Bridges and Plugins.
-   **Core**: Owns "Mechanism" (File formats, Lifecycle state, Idempotency). Encapsulated in `prloom-core`.

No userland code needs to import internal paths or read `.local` JSON files.

---

## Summary of New Primitives

### Configuration

| Primitive | Scope | Purpose |
|-----------|-------|---------|
| `globalBridges` | Global | Register repo-level bridges |
| `globalPlugins` | Global | Register repo-level plugins |

### Bridges

| Primitive | Scope | Purpose |
|-----------|-------|---------|
| `prloom-core` | Global | Handle `upsert_plan`, emit lifecycle events |

### Hooks

| Primitive | Scope | Purpose |
|-----------|-------|---------|
| `onGlobalEvent` | Global | React to global bus events |
| `beforeRoute` | Global | Intercept/block actions before delivery |
| `beforeUpsert` | Global | Transform/validate plan content before write |
| `afterActivate` | Global | Setup after plan moves from inbox to worktree |
| `onEvent` | Plan | React to plan bus events (replaces `beforeTriage`) |
| `afterDesign` | Plan | Validation after designer creates plan |
| `beforeTodo` | Plan | Pre-checks before starting a TODO |
| `afterTodo` | Plan | Run tests/lint after completing a TODO |
| `beforeFinish` | Plan | Review council, final checks |
| `afterFinish` | Plan | Notifications, cleanup |

### Events (Global Bus)

| Primitive | Purpose |
|-----------|---------|
| `plan_created` | New plan appeared in inbox or worktree |
| `plan_edited` | Plan content changed |
| `plan_status_changed` | Plan moved between states |
| `plan_deleted` | Plan was removed |

### Context Methods

| Primitive | Scope | Purpose |
|-----------|-------|---------|
| `readPlan(planId?)` | Both | Read plan content; `planId` optional in plan scope, required in global |
| `listPlans(filter?)` | Global | Query plans by status/source/hidden |

### PlanState Extensions

| Primitive | Type | Purpose |
|-----------|------|---------|
| `hidden` | `boolean` | If true, dispatcher ignores this plan during activation |
