# RFC: Plugin/Bridge Primitives for Interception & Orchestration

**Status:** Implemented
**Author:** prloom team
**Created:** 2026-01-12

---

## Summary

This RFC proposes a minimal set of new primitives to make plugin/bridge orchestration more flexible while keeping the system simple. The additions center on **pre‑triage event interception**, **plugin state persistence**, and **ergonomic helpers** for bus actions and event handling.

---

## Goals

1. Allow plugins to intercept and claim PR feedback before triage.
2. Provide a durable plugin state store (per‑plan and optional global).
3. Reduce the need to parse `.bus` files directly.
4. Keep the dispatcher flow predictable and backwards compatible.

Non‑goals:
- Redesign the bus architecture
- Replace the existing triage agent flow

---

## Proposed Primitives

### 1) `beforeTriage` Hook Point (Event Interception)

Introduce a new hook point that runs **after** events are polled and **before** triage processes them.

```ts
// New hook point
export type HookPoint =
  | "afterDesign"
  | "beforeTodo"
  | "afterTodo"
  | "beforeFinish"
  | "afterFinish"
  | "beforeTriage";
```

`beforeTriage` receives the **new, unprocessed events** for the current plan.

```ts
interface HookContext {
  // Existing
  emitAction(...): void;
  runAgent(...): Promise<string>;

  // New (only for beforeTriage)
  events?: Event[];
  markEventHandled?: (eventId: string) => void;
  markEventDeferred?: (eventId: string, reason?: string) => void;
}
```

**Semantics**:
- `markEventHandled(id)` → event is added to processed IDs, never triaged.
- `markEventDeferred(id)` → event is skipped for triage and retried later.
- unmarked events → flow into triage as today.

---

### 2) Plugin State Store (Per‑Plan)

Provide a persistent key/value store for plugin state in the worktree.

```ts
interface HookContext {
  getState?: (key: string) => JsonValue | undefined;
  setState?: (key: string, value: JsonValue) => void;
}
```

**Backing store:**
```
<worktree>/prloom/.local/plugin-state/<pluginName>.json
```

This allows cursors, retries, and policy flags to survive restarts.

---

### 3) Optional Global Plugin State

Some plugins need cross‑plan coordination (rate limits, reviewer rotation, org policy). Add a **repo‑level** state store:

```ts
interface HookContext {
  getGlobalState?: (key: string) => JsonValue | undefined;
  setGlobalState?: (key: string, value: JsonValue) => void;
}
```

**Backing store:**
```
<repoRoot>/prloom/.local/plugin-state-global/<pluginName>.json
```

---

### 4) `readEvents()` Helper (Optional)

Expose a helper to read events without parsing `.bus` files directly.

```ts
interface HookContext {
  readEvents?: (options?: {
    types?: string[];
    sinceId?: string;
    limit?: number;
  }) => Promise<{ events: Event[]; lastId?: string }>;
}
```

This is useful for polling‑style plugins that do not need interception.

---

### 5) Action Helpers

Provide helper functions that wrap `emitAction` boilerplate and standardize IDs.

```ts
interface HookContext {
  emitComment?: (target: ReplyAddress, message: string) => void;
  emitReview?: (target: ReplyAddress, review: ReviewSubmission) => void;
  emitMerge?: (target: ReplyAddress, method?: "merge" | "squash" | "rebase") => void;
}
```

---

### 6) Deferred Retry Guidance

Add a lightweight backoff signal so plugins can defer events without hot‑looping.

```ts
markEventDeferred?: (eventId: string, reason?: string, retryAfterMs?: number) => void;
```

Dispatcher records a `deferredUntil` timestamp per event ID and skips it until the backoff elapses.

---

## Example: Comment‑Driven Policy Updates

A plugin that intercepts comments with a special marker and updates a memory file:

```ts
const MARKER = "!memory";

export default function policyPlugin() {
  return {
    beforeTriage: async (plan, ctx) => {
      if (!ctx.events) return plan;

      for (const event of ctx.events) {
        if (event.type !== "pr_comment") continue;
        if (!event.body.includes(MARKER)) continue;

        try {
          const content = event.body.split(MARKER)[1].trim();
          // custom logic: write to agent.md / call external memory system
          // ...
          ctx.markEventHandled?.(event.id);
        } catch (error) {
          ctx.markEventDeferred?.(event.id, "memory-update-failed", 60000);
        }
      }

      return plan;
    },
  };
}
```

---

## Dispatcher Changes (Minimal)

Current flow:
```
bridges.poll → append events.jsonl → triage → emit actions
```

Proposed flow:
```
bridges.poll → append events.jsonl → beforeTriage hooks → triage → emit actions
```

Where:
- `beforeTriage` receives new, unprocessed events.
- handled/deferred events are excluded from triage.

---

## Backwards Compatibility

- Existing plugins are unaffected (no new required fields).
- Triage behavior remains unchanged for unhandled events.
- If no plugin implements `beforeTriage`, behavior is identical to today.

---

## Open Questions (Recommendations)

1. **Visibility**: show deferred events in `prloom status` with count + oldest age. This helps detect stuck plugins.
2. **Cursors**: make `readEvents()` independent from triage cursors (plugin‑managed), to avoid unexpected side effects.
3. **Scope**: keep `beforeTriage` per‑plan (matches current plan‑scoped dispatcher flow and avoids cross‑plan coupling).

---

## Implementation Sketch

1. Extend hook registry with `beforeTriage`.
2. Add event interception in dispatcher before triage.
3. Add `processedEventIds` vs `deferredEventIds` tracking (with optional backoff timestamps).
4. Add plugin state storage utilities.
5. Add helper functions on `HookContext`.

---

## Alternatives Considered

- Allowing plugins to read `.bus` directly (current workaround) → rejected for ergonomics and safety.
- Moving all triage logic into plugins → too heavy, not aligned with current workflow.

---

## Conclusion

These primitives preserve the current architecture while unlocking advanced workflows (policy enforcement, automation, custom routing) without forcing plugin authors to manipulate bus files or duplicate dispatcher logic.
