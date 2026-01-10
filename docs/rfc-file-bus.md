# RFC: File Bus Architecture

**Status:** Proposal
**Author:** prloom team
**Created:** 2026-01-08
**Last Updated:** 2026-01-09

---

## Summary

prloom adopts a **File Bus architecture** for the feedback loop (events and actions). The bus handles:

- **Events IN**: GitHub comments, Buildkite failures, etc.
- **Actions OUT**: Post comment, submit review, etc.

**Lifecycle operations** (create PR, mark ready, update description) remain direct dispatcher calls—they are not abstracted through the bus.

---

## Design Goals

1. **Transparent by default**: GitHub users see no changes
2. **Cross-routing**: Buildkite failure → GitHub comment
3. **Simple bridge authoring**: Just implement `events()` and/or `actions()`
4. **Lifecycle is explicit**: Not pretending it's generic

## Non-goals

- Exactly-once delivery (at-least-once is fine)
- Abstracting lifecycle operations (create PR, mark ready)

---

## Key Concepts

### What Goes Through the Bus

| Concern               | Through Bus? | Mechanism                        |
| --------------------- | ------------ | -------------------------------- |
| Poll comments/reviews | ✅ Yes       | `events()` → events              |
| Post comments/reviews | ✅ Yes       | actions → `actions()`            |
| Create PR             | ❌ No        | Dispatcher calls GitHub directly |
| Mark PR ready         | ❌ No        | Dispatcher calls GitHub directly |
| Update PR body        | ❌ No        | Dispatcher calls GitHub directly |

The dispatcher knows about **plan lifecycle**. It doesn't know about **where feedback comes from or where responses go**.

---

## Directory Layout

```
<worktree>/prloom/.bus/
├── events.jsonl
├── actions.jsonl
└── state/
    ├── dispatcher.json          # Events offset, processed event IDs
    ├── bridge.<name>.json       # Inbound bridge state (cursors)
    └── bridge.<name>.actions.json # Outbound bridge state (delivery tracking)
```

---

## Delivery Semantics

### Inbound

prloom calls `events()` on each bridge's interval and persists the returned `state` automatically.

### Outbound

Outbox delivery is **at-least-once**:

- prloom tracks which actions have been delivered per bridge in `state/bridge.<name>.actions.json`
- prloom only calls `actions()` for actions where `target` matches `bridge.targets`
- On success, prloom marks the action as delivered
- On failure with `retryable: true`, prloom retries later
- On failure with `retryable: false`, prloom logs and moves on

**Outbound bridges must be idempotent by `Action.id`** — if the same action is delivered twice (due to crash/restart), the bridge should handle it gracefully.

**Implementation:** Bridges should store a durable mapping from `Action.id` → external artifact ID in their state file:

```ts
// state/bridge.github.actions.json
{
  "deliveredActions": {
    "action-123": { "commentId": 456789 },
    "action-124": { "reviewId": 789012 }
  }
}
```

On each `actions()` call, check if the action was already delivered:

```ts
async actions(ctx, action) {
  const state = await loadState();
  if (state.deliveredActions[action.id]) {
    return { success: true };  // Already delivered, skip
  }

  const commentId = await postGitHubComment(...);
  state.deliveredActions[action.id] = { commentId };
  await saveState(state);
  return { success: true };
}
```

This ensures at-least-once delivery without duplicate comments.

### Target Ownership

Each target must be claimed by **exactly one** bridge:

- **Duplicate targets**: If two bridges claim the same target, prloom fails at startup with an error.
- **Unclaimed target**: If an action targets something no bridge claims, prloom logs a warning and skips the action (it remains in actions.jsonl but is not retried).

---

## Types

### BusRecord (JSONL Envelope)

```ts
export type BusRecord = {
  ts: string;
  kind: "event" | "action";
  schemaVersion: 1;
  data: Event | Action;
};
```

### Event

```ts
export type Event = {
  id: string;
  source: string;
  type: string;
  severity: "info" | "warning" | "error";
  title: string;
  body: string;
  replyTo?: ReplyAddress;
  context?: Record<string, JsonValue>;
};

export type ReplyAddress = {
  target: string;
  token?: JsonValue;
};
```

### Action

Actions are for **external communication only**. Internal operations (like TODO creation) are handled directly by the dispatcher.

```ts
export type Action = {
  id: string;
  type: "respond";
  target: ReplyAddress;
  payload: OutboundPayload;
  relatedEventId?: string;
};

export type OutboundPayload =
  | { type: "comment"; message: string }
  | { type: "inline_comment"; path: string; line: number; message: string }
  | {
      type: "review";
      verdict: "approve" | "request_changes" | "comment";
      summary: string;
      comments: InlineComment[];
    };
```

---

## Bridge Interface

Bridges are TypeScript modules. A bridge can be:

- **Inbound-only**: Just `events()` (e.g., Buildkite)
- **Outbound-only**: Just `actions()` + `targets` (rare)
- **Both**: `events()` + `actions()` + `targets` (e.g., GitHub)

### Timing

prloom calls `events()` on all bridges **every tick** (configurable via `bus.tickIntervalMs`, default 1 second). Bridges handle their own timing internally using persisted state and their config:

```ts
async events(ctx, state) {
  const pollInterval = ctx.config?.pollIntervalMs ?? 60000;  // Default 60s
  const lastPoll = state?.lastPollTime ?? 0;
  if (Date.now() - lastPoll < pollInterval) {
    return { events: [], state };  // Too soon, skip
  }

  const events = await pollExternal(...);
  return { events, state: { ...state, lastPollTime: Date.now() } };
}
```

Bridge-specific configuration (like `pollIntervalMs`) is passed via `ctx.config` from the user's config file.

### Types (Discriminated)

```ts
export type BridgeContext = {
  repoRoot: string;
  worktree: string;
  branch?: string;
  changeRequestRef?: string;
  /** Bridge-specific config from prloom/config.json (e.g., pollIntervalMs) */
  config?: JsonValue;
};

export type ActionResult =
  | { success: true }
  | { success: false; error: string; retryable: boolean };

// Inbound-only bridge
export type InboundBridge = {
  name: string;
  events(
    ctx: BridgeContext,
    state: JsonValue | undefined
  ): Promise<{
    events: Event[];
    state: JsonValue;
  }>;
};

// Outbound-only bridge (rare)
export type OutboundBridge = {
  name: string;
  targets: string[];
  actions(ctx: BridgeContext, action: Action): Promise<ActionResult>;
};

// Full bridge (both directions)
export type FullBridge = {
  name: string;
  targets: string[];
  events(
    ctx: BridgeContext,
    state: JsonValue | undefined
  ): Promise<{
    events: Event[];
    state: JsonValue;
  }>;
  actions(ctx: BridgeContext, action: Action): Promise<ActionResult>;
};

export type Bridge = InboundBridge | OutboundBridge | FullBridge;
```

**Key constraint:** If `actions` is defined, `targets` must be defined (and vice versa).

---

## Configuration

```json
{
  "bus": {
    "tickIntervalMs": 1000
  },
  "bridges": {
    "github": { "enabled": true, "pollIntervalMs": 60000 },
    "buildkite": {
      "enabled": true,
      "pollIntervalMs": 120000,
      "module": "./bridges/buildkite.ts"
    }
  }
}
```

- `tickIntervalMs`: How often prloom calls bridge `events()` methods (default: 1 second)
- Each bridge config is passed to the bridge via `ctx.config`
- `enabled` is standard; other options are freeform per bridge (e.g., `pollIntervalMs`)

---

## Example Bridges

### GitHub (Full Bridge)

```ts
const DEFAULT_POLL_INTERVAL = 60000;

const githubBridge: FullBridge = {
  name: "github",
  targets: ["github-pr"],

  async events(ctx, state) {
    // Use configured poll interval, fallback to default
    const pollInterval = ctx.config?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;
    if (Date.now() - (state?.lastPollTime ?? 0) < pollInterval) {
      return { events: [], state };
    }

    const comments = await pollGitHubComments(ctx, state?.lastCommentId);
    return {
      events: comments.map((c) => ({
        id: `github-comment-${c.id}`,
        source: "github",
        type: "comment",
        replyTo: {
          target: "github-pr",
          token: { prNumber: ctx.changeRequestRef },
        },
      })),
      state: { lastCommentId: comments[0]?.id, lastPollTime: Date.now() },
    };
  },

  async actions(ctx, action) {
    if (action.type === "respond") {
      await postGitHubComment(action.target.token, action.payload);
      return { success: true };
    }
    return { success: false, error: "Unknown action", retryable: false };
  },
};
```

### Buildkite (Inbound-Only)

```ts
const POLL_INTERVAL = 120000;

const buildkiteBridge: InboundBridge = {
  name: "buildkite",

  async events(ctx, state) {
    if (Date.now() - (state?.lastPollTime ?? 0) < POLL_INTERVAL) {
      return { events: [], state };
    }

    const builds = await pollBuildkite(ctx.branch, state?.lastBuildId);
    return {
      events: builds
        .filter((b) => b.failed)
        .map((b) => ({
          id: `buildkite-${b.id}`,
          source: "buildkite",
          type: "build_failure",
          severity: "error",
          title: `Build failed`,
          body: b.errorMessage,
          replyTo: { target: "github-pr", token: { prNumber: b.prNumber } },
        })),
      state: { lastBuildId: builds[0]?.id, lastPollTime: Date.now() },
    };
  },
  // No actions, no targets
};
```

---

## Dispatcher Flow

1. Poll each bridge's `events()` on its interval
2. Append events to `events.jsonl`
3. Read events, dedupe by `Event.id`
4. Run triage on new events
5. Append actions to `actions.jsonl`
6. Route actions to bridges based on `target` matching `bridge.targets`

---

## Migration Path

1. Create bus directory and JSONL files
2. Refactor GitHub comment polling → `events()`
3. Refactor GitHub comment posting → `actions()`
4. Keep lifecycle (create PR, mark ready) as direct calls
5. Document bridge authoring for CI integrations

---

## Open Questions

1. **Schema evolution**: Bump `schemaVersion` on breaking changes only?
2. **Backpressure**: Rotation/compaction for long-running buses?
