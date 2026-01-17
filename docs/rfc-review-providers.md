# RFC: Review Providers

**Status:** Draft
**Author:** prloom team
**Created:** 2026-01-16
**Last Updated:** 2026-01-16

---

## Summary

Introduce a first-class **Review Provider** abstraction that owns inbound review feedback and outbound review replies. Providers are mutually exclusive (one active at a time) and replace the current mix of bridge config + GitHub feature flags. Built-in providers include **GitHub** and **Local (review.md)**, with support for **custom providers** (GitLab, Bitbucket, etc.) via modules.

This RFC defines:
- A new `review.provider` config block
- Provider polling and reply contracts
- Local `prloom/.local/review.md` ingestion
- Triage integration for non-GitHub review sources
- Automatic `review.md` checkbox updates on TODO completion

---

## Motivation

We currently configure review ingestion in two places:
- `github.enabled` (PR lifecycle + PR updates)
- `bridges.github` (comment/review polling)

This is confusing and makes it easy to enable incompatible states (both local and GitHub, or neither). We also want to support VS Code-based local review comments and custom review sources without exposing internal bridge mechanics.

We need a **single, intentional switch** for review input that works end-to-end (ingest → triage → TODOs → mark resolved) while preserving extension points for other systems.

---

## Goals

1. Provide a single configuration surface for review input.
2. Support built-in review providers: GitHub and local `review.md`.
3. Support custom review providers via modules.
4. Allow triage to run on non-GitHub feedback.
5. Update local `review.md` as TODOs are completed.
6. Remove the need to toggle multiple flags.

## Non-goals

- Replace the File Bus architecture.
- Remove the existing GitHub bridge implementation.
- Support multiple review providers simultaneously.
- Add mandatory identifiers to review items.

---

## Proposal

### 1) Review Providers (New Concept)

A **Review Provider** is a built-in or custom module that:
- Polls for review items
- Emits normalized review feedback
- Optionally handles review replies

Only **one provider** may be active at a time.

### 2) Built-in Providers

#### GitHub Provider
- Uses the existing GitHub bridge internally for polling and replies.
- Behavior is identical to today for GitHub feedback.
- Enabled when `review.provider = "github"`.

#### Local Provider
- Polls `prloom/.local/review.md` for unchecked items in `## ready`.
- Emits review feedback for triage.
- Does not post triage replies externally.
- Updates `review.md` checkboxes to `[x]` when TODOs complete.

### 3) Custom Providers

Users can plug in other systems (GitLab, Bitbucket, Gerrit) via a module implementing the provider contract.

---

## Provider Contract

Providers return normalized review items. A provider may also implement `respond()` to deliver triage replies.

```ts
export interface ReviewProvider {
  name: string;
  poll: (
    ctx: {
      repoRoot: string;
      worktree: string;
      planId: string;
      config?: unknown;
      log: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
    },
    state: Record<string, unknown> | undefined
  ) => Promise<{ items: ReviewItem[]; state: Record<string, unknown> }>;

  respond?: (
    ctx: {
      repoRoot: string;
      worktree: string;
      planId: string;
      config?: unknown;
    },
    response: { message: string; relatedItemId?: string | number }
  ) => Promise<{ success: true } | { success: false; error: string }>;
}

export interface ReviewItem {
  id: string | number;
  author: string;
  body: string;
  createdAt: string; // ISO
  path?: string;
  line?: number;
  side?: "left" | "right";
  diffHunk?: string;
  reviewState?: string;
}
```

---

## Configuration

### New config

```json
{
  "review": {
    "provider": "local",
    "local": {
      "pollIntervalMs": 2000
    },
    "github": {
      "pollIntervalMs": 60000
    },
    "custom": {
      "module": "./review-providers/gitlab.js",
      "pollIntervalMs": 10000,
      "config": { "host": "https://gitlab.example.com", "token": "..." }
    }
  }
}
```

### Semantics

- `review.provider` is required and **mutually exclusive**.
- `provider = "github"` registers the built-in GitHub provider.
- `provider = "local"` registers the built-in local provider.
- `provider = "custom"` loads a custom provider module.
- Local provider always reads `prloom/.local/review.md`.

### Compatibility

- If `review` is not present, fall back to the current GitHub behavior (backwards compatible).
- If `review` is present, ignore `bridges.github` and derive `github.enabled` from the provider.
- If both the old and new settings are present, emit a config warning and prefer `review`.

---

## Event Flow

```
Review Provider -> Bus Event -> Triage -> TODOs -> TODO completion -> Provider update
```

### Provider to Bus

Providers emit bus events with a common context so triage can run against any source.

Event shape (conceptual):
- `source`: `review:<providerName>`
- `type`: `review_comment` (or `review_feedback`)
- `context`: `{ provider, itemId, author, createdAt, path, line, side, diffHunk, reviewState }`

### Triage Integration

Changes required:
- Accept review events from **any provider**, not just GitHub.
- Run triage even when there is no PR.
- If provider does not implement `respond`, skip posting triage replies.

### TODO Context for Resolution

To support checkbox updates in `review.md`, triage must include structured context lines for review items. Example:

```
- [ ] Add input validation
  review_provider: local
  file: src/form.ts
  line: 42
  side: right
```

---

## Local Provider Implementation

### Parsing

- Read `prloom/.local/review.md` as UTF-8.
- Locate the `## ready` section (case-insensitive heading match).
- Parse each list item starting with `- [ ]` as a review item.
- Capture the item body text and its indented metadata lines (`file:`, `line:`, `side:`).
- Ignore `- [x]` entries (already resolved) and any comments outside `## ready`.

### Validation

- Require `file` and `line` for each ready item; skip invalid entries with a warning.
- Default `side` to `right` if missing.

### Dedupe

- Compute a stable hash per ready item: `hash(text + file + line + side)`.
- Store hashes in provider state (`bridge.<name>.json` style) to avoid re-emitting the same item.
- If an item disappears or is marked `[x]`, remove it from the stored hash set.

## Local Review File Format

Local provider reads `prloom/.local/review.md`:

```markdown
# Code Review

## staged

- Draft comment
  file: src/utils.ts
  side: right
  line: 15

## ready

- [ ] Add input validation
  file: src/form.ts
  side: right
  line: 42

- [x] Fix typo
  file: src/api.ts
  side: right
  line: 88
```

Rules:
- Only items under `## ready` with `[ ]` are ingested.
- `[x]` items are ignored (already addressed).
- `file` and `line` are required for local provider.
- `side` is optional; default to `right` if missing.

---

## Resolution Loop

When a TODO completes:
1. Extract `review_provider`, `file`, `line`, and `side` from TODO context.
2. If `review_provider = local`, locate the matching item in `review.md`.
3. Match by `text + file + line + side` (IDs are not required).
4. Replace `[ ]` with `[x]`.

If no match is found, log a warning and continue.

---

## Implementation Notes

- The existing GitHub bridge remains in code, but is no longer user-configured.
- Review providers are the only mechanism that can emit review feedback.
- Custom providers are loaded similarly to bridges, but are distinct and mutually exclusive.
- Local provider maintains a hash/cursor state to avoid re-emitting the same ready items.

---

## Testing

1. Local provider parsing + dedupe
2. Triage with non-GitHub events and no PR
3. TODO completion updates `review.md`
4. Config compatibility and validation
5. Custom provider module loading

---

## Alternatives Considered

- Keep GitHub and local as normal bridges: rejected (confusing, easy to misconfigure).
- Require stable IDs in review.md: rejected (adds UX overhead).

---

## Decisions

- Review file path is fixed to `prloom/.local/review.md`.
- Event type uses provider-agnostic `review_feedback` with original feedback kind stored in context.
- Local providers do not emit triage replies.
