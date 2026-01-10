# Event Bus

The bus handles asynchronous events from external sources (GitHub comments, CI failures) and routes outbound actions (post comment, submit review).

See also: [RFC: File Bus Architecture](./rfc-file-bus.md)

## Directory Layout

Each worktree has a `prloom/.bus/` directory:

```
<worktree>/prloom/.bus/
├── events.jsonl                    # Inbound events
├── actions.jsonl                   # Outbound actions
└── state/
    ├── dispatcher.json             # Events/actions offsets, processed event IDs
    ├── bridge.<name>.json          # Per-bridge inbound state (poll cursors)
    └── bridge.<name>.actions.json  # Per-bridge outbound state (delivery tracking)
```

## Core Types

### BusRecord (JSONL Envelope)

Every line in `events.jsonl` and `actions.jsonl` is wrapped:

```typescript
interface BusRecord {
  ts: string;              // ISO timestamp
  kind: "event" | "action";
  schemaVersion: 1;
  data: Event | Action;
}
```

### Event

```typescript
interface Event {
  id: string;                          // Unique ID for deduplication
  source: string;                      // Bridge name (e.g., "github")
  type: string;                        // Event type (e.g., "pr_comment")
  severity: "info" | "warning" | "error";
  title: string;
  body: string;
  replyTo?: ReplyAddress;              // Where to send responses
  context?: Record<string, JsonValue>; // Source-specific metadata
}

interface ReplyAddress {
  target: string;          // Target name (e.g., "github-pr")
  token?: JsonValue;       // Routing info (e.g., { prNumber: 123 })
}
```

### Action

```typescript
interface Action {
  id: string;
  type: "respond";
  target: ReplyAddress;
  payload: OutboundPayload;
  relatedEventId?: string;  // Links response to triggering event
}

type OutboundPayload =
  | { type: "comment"; message: string }
  | { type: "inline_comment"; path: string; line: number; message: string }
  | {
      type: "review";
      verdict: "approve" | "request_changes" | "comment";
      summary: string;
      comments: InlineComment[];
    };
```

## Bridges

Bridges connect the bus to external systems. Located in `src/lib/bus/bridges/`.

### Bridge Types

| Type | Capability | Example |
|------|------------|---------|
| `InboundBridge` | Polls for events | Buildkite CI |
| `OutboundBridge` | Executes actions | (rare) |
| `FullBridge` | Both | GitHub |

### Bridge Interface

```typescript
interface BridgeContext {
  repoRoot: string;
  worktree: string;
  branch?: string;
  changeRequestRef?: string;   // PR number as string
  config?: JsonValue;          // Bridge config from prloom/config.json
}

type ActionResult =
  | { success: true }
  | { success: false; error: string; retryable: boolean };

// Inbound-only
interface InboundBridge {
  name: string;
  events(ctx: BridgeContext, state: JsonValue | undefined): Promise<{
    events: Event[];
    state: JsonValue;
  }>;
}

// Full bridge (most common)
interface FullBridge {
  name: string;
  targets: string[];           // Targets this bridge handles (e.g., ["github-pr"])
  events(ctx: BridgeContext, state: JsonValue | undefined): Promise<{
    events: Event[];
    state: JsonValue;
  }>;
  actions(ctx: BridgeContext, action: Action): Promise<ActionResult>;
}
```

### GitHub Bridge

The built-in GitHub bridge (`src/lib/bus/bridges/github.ts`):

- **Target**: `github-pr`
- **Events**: Polls PR comments, reviews, review comments
- **Actions**: Posts comments, submits reviews
- **Idempotency**: Tracks delivered actions in `bridge.github.actions.json`

## Flow

```
1. tickBusEvents()
   └── Each bridge.events() polls → appends to events.jsonl

2. readBusEventsForTriage()
   └── Reads events.jsonl from offset → deduplicates by Event.id

3. Triage processes events
   └── Creates TODOs, decides responses

4. appendBusAction()
   └── Queues actions to actions.jsonl

5. tickBusActions()
   └── Reads actions.jsonl → routes to bridges by target
```

### Delivery Semantics

**Inbound**: Events are deduplicated by `Event.id`. The dispatcher tracks `processedEventIds` to avoid reprocessing.

**Outbound**: At-least-once delivery:
- Actions are read from `actions.jsonl` using byte offsets
- On success, offset advances past the action
- On retryable failure, offset stays put (retry on next tick)
- On non-retryable failure, offset advances (action is skipped)
- Bridges must be idempotent by `Action.id` (check `deliveredActions` state)

### Target Ownership

Each target must be claimed by exactly one bridge:
- **Duplicate targets**: Startup fails with error
- **Unclaimed target**: Action is logged and skipped (non-retryable)

## Configuration

```json
{
  "bus": {
    "tickIntervalMs": 1000
  },
  "bridges": {
    "github": {
      "enabled": true,
      "pollIntervalMs": 60000
    },
    "buildkite": {
      "enabled": true,
      "pollIntervalMs": 120000,
      "module": "./bridges/buildkite.ts"
    }
  }
}
```

- `bus.tickIntervalMs`: How often the dispatcher tick loop runs (default: 1000ms)
- `bridges.<name>.enabled`: Enable/disable the bridge
- `bridges.<name>.pollIntervalMs`: Bridge-specific poll interval (bridges self-throttle)
- `bridges.<name>.module`: Path to custom bridge module (relative to repo root)

## Adding a Custom Bridge

1. Create your bridge module (e.g., `./bridges/slack.ts`):

```typescript
import type { FullBridge, BridgeContext, Event, Action, ActionResult, JsonValue } from "prloom";

export const slackBridge: FullBridge = {
  name: "slack",
  targets: ["slack-channel"],

  async events(ctx, state) {
    const pollInterval = (ctx.config as any)?.pollIntervalMs ?? 60000;
    const lastPoll = (state as any)?.lastPollTime ?? 0;
    
    if (Date.now() - lastPoll < pollInterval) {
      return { events: [], state: state ?? {} };
    }

    // Poll Slack for messages...
    const events: Event[] = [];
    
    return {
      events,
      state: { lastPollTime: Date.now() } as unknown as JsonValue,
    };
  },

  async actions(ctx, action) {
    // Post to Slack...
    return { success: true };
  },
};

export default slackBridge;
```

2. Add to config:

```json
{
  "bridges": {
    "slack": {
      "enabled": true,
      "pollIntervalMs": 30000,
      "module": "./bridges/slack.ts"
    }
  }
}
```

3. The bridge is automatically loaded and registered at dispatcher startup.

## State Files

### dispatcher.json

```json
{
  "eventsOffset": 4523,
  "actionsOffset": 1234,
  "processedEventIds": ["github-issue_comment-123", "github-review-456"]
}
```

### bridge.github.json (inbound state)

```json
{
  "lastPollTime": 1704825600000,
  "cursors": {
    "lastIssueCommentId": 123,
    "lastReviewId": 456,
    "lastReviewCommentId": 789
  },
  "botLogin": "prloom[bot]"
}
```

### bridge.github.actions.json (outbound state)

```json
{
  "deliveredActions": {
    "action-comment-1704825600000-abc123": {
      "deliveredAt": "2024-01-10T00:00:00.000Z",
      "prNumber": 42,
      "commentId": 987654321
    }
  }
}
```
