# Workflows

## Plan Lifecycle

```
prloom/.local/inbox/<id>.md
     │ status: draft (metadata in inbox/<id>.json)
     │
     ▼ (user queues)
prloom/.local/inbox/<id>.md
     │ status: queued
     │
     ▼ (dispatcher ingests)
<worktree>/prloom/.local/plan.md
<worktree>/prloom/.local/state.json
     │ status: active
     │ + branch created
     │ + draft PR opened (if GitHub enabled)
     │
     ▼ (TODOs executed)
     │ status: active
     │ commits pushed
     │
     ▼ (all TODOs done)
     │ status: review
     │ PR marked ready (if enabled)
     │
     ▼ (feedback → triage)
     │ status: triaging
     │ new TODOs added
     │
     ▼ (back to active)
     │ status: active
     │
     ▼ (PR merged/closed)
     plan removed from state
```


## Status Transitions

| From | To | Trigger |
|------|----|---------|
| draft | queued | User runs `prloom queue <id>` |
| queued | active | Dispatcher ingests plan |
| active | review | All TODOs completed |
| active | triaging | New feedback received |
| triaging | active | Triage complete |
| review | active | New TODOs added from feedback |
| review | done | Manual/archive via external tooling |

`done` is treated like `review`; new TODOs flip it back to `active`.

## Blocking

Blocking is a flag on the plan (status remains unchanged). Plans can be blocked by:
- TODO marked with `[b]` (explicit block marker)
- TODO failing 3 times consecutively
- Triage/worker hook errors
- Rebase conflicts

Unblock with `prloom unblock <id>`.

## Hidden Plans

Plans can be marked `hidden` in metadata (typically via global bridges). Hidden plans are tracked but ignored by the dispatcher until un-hidden.

## Agent Stages

| Stage | Purpose | Config key |
|-------|---------|------------|
| designer | Creates plan from user description | `agents.<name>.designer` |
| worker | Executes individual TODOs | `agents.<name>.worker` |
| triage | Processes PR feedback into TODOs | `agents.<name>.triage` |
