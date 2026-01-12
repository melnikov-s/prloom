# End-to-end (E2E) tests with mocked critical services

This doc sketches what it would take to add **end-to-end tests** to `prloom` while mocking the “critical services” (GitHub + agent CLIs), and keeping the tests fast, deterministic, and offline.

It assumes the architecture in `docs/architecture.md` and the File Bus RFC already exist. The lifecycle hooks/plugins system described in `docs/rfc-lifecycle-hooks.md` has been implemented and should be tested.

## Why E2E here is non-trivial

The CLI `prloom start`:

- starts `runDispatcher()` which is an infinite loop (`while (true)`), and
- launches the Ink TUI.

So “E2E via invoking the real CLI” is not a great fit for normal unit-test runners.

Instead, the practical E2E seam is **one dispatcher iteration**:

- `ingestInboxPlans(...)` to go from inbox → worktree/branch/(optional) PR
- `processActivePlans(...)` to run the next TODO, commit, and (optionally) PR updates / bus triage

Both are already exported from `src/lib/dispatcher.ts`.

## Target: what an E2E test should prove

A minimal “happy path” E2E should verify:

1. An inbox plan (`prloom/.local/inbox/<id>.md`) is ingested into a worktree/branch.
2. If GitHub is enabled, a draft PR is created (via `gh pr create`) and its number is recorded.
3. The worker runs (via an agent adapter), marks exactly one TODO as done, and creates a real git commit.
4. If GitHub is enabled, the PR body is updated and (when all TODOs complete) it is marked ready.

### With lifecycle hooks

Since lifecycle hooks are implemented, E2E should also prove hook ordering and side effects.

At minimum, add coverage for these hook points:

- `beforeTodo`: runs before the worker executes a TODO
- `afterTodo`: runs after the TODO is completed (receives `ctx.todoCompleted` with the completed TODO text)
- `beforeFinish`: runs before `markPRReady`; can add TODOs and prevent finishing
- `afterFinish`: runs after finishing (notifications/cleanup)

Note: There is also an `afterDesign` hook (runs after the designer creates a plan), but this is triggered from CLI commands (`prloom new`, `prloom edit`), not from the dispatcher loop. E2E tests focusing on dispatcher flow don't need to cover `afterDesign`.

The easiest way to assert ordering is via a test-only “trace” file written by hooks and by the fake agent binary.

Example trace assertions:

- `beforeTodo` hook appends `{"hook":"beforeTodo","planId":"...","ts":"..."}` to `prloom/.local/e2e-trace.jsonl`
- worker shim appends `{"hook":"worker","planId":"...","ts":"..."}`
- `afterTodo` hook appends `{"hook":"afterTodo","planId":"...","todoCompleted":"...","ts":"..."}`
- test asserts the order is `beforeTodo → worker → afterTodo`

Including `planId` and timestamp in trace entries aids debugging when tests fail.

Secondary E2E scenarios worth adding after the first one:

- “local-only mode” (GitHub disabled): no `gh` calls, but worktree + commits still occur.
- retry/blocking behavior: worker does not mark TODO complete → retry increments → blocks after max retries.
- feedback triage: bus produces a GitHub event → triage agent runs → plan gains TODOs.
- hook abort: a hook throws → plan is blocked or dispatcher logs error and skips further processing for that plan.

## Critical services to mock

prloom’s external world is mostly accessed through shell commands:

- `gh` (GitHub CLI) via `execa("gh", ...)`
- agent CLIs (`opencode`, `codex`, `claude`, `gemini`) via `execa(...)`
- optionally `tmux` via `execa("tmux", ...)`

Git is also invoked via `execa("git", ...)`, but for E2E tests it is usually best to **use real git** against a temporary repository.

With lifecycle hooks, plugins may also run agents and/or emit bus actions:

- `ctx.runAgent(...)` should invoke the configured adapter (so agent CLIs still need to be stubbed)
- `ctx.emitAction(...)` should append to the worktree bus outbox (`prloom/.bus/actions.jsonl`)

## Recommended mocking strategy: PATH shims

Rather than mocking `execa` at the module level (which is awkward with ESM), create a temp `bin/` directory and prepend it to `PATH` for the test process.

That directory contains executable scripts named:

- `gh`
- `opencode` (and optionally `codex`, `claude`, `gemini`)
- (optional) `tmux`

Because the app invokes these by name, `execa("gh", ...)` will execute your stub.

This avoids invasive refactors and keeps the test “real” at the boundaries.

### What the `gh` shim needs to support

Minimal commands for ingestion + completion flow:

- `gh api user --jq '{id: .id, login: .login}'`
  - return something like `{ "id": 1, "login": "test-bot" }`
- `gh pr create --draft ... --head <branch> --base <base> --title <t> --body <b>`
  - print a URL containing `/pull/<number>` so `createDraftPR()` can parse it
- `gh pr edit <n> --body <b>`
  - succeed
- `gh pr ready <n>`
  - succeed
- `gh pr view <n> --json state -q .state`
  - return `OPEN` / `MERGED` / `CLOSED`

If/when you add E2E for feedback triage, also implement:

- `gh api repos/{owner}/{repo}/issues/<n>/comments --jq ...`
- `gh api repos/{owner}/{repo}/pulls/<n>/reviews --jq ...`
- `gh api repos/{owner}/{repo}/pulls/<n>/comments --jq ...`

Tip: persist state in a JSON file so multiple calls can coordinate. Note: the dispatcher calls `gh` sequentially (not concurrently), so simple JSON file state is safe without locking. The only concurrent `gh` calls are read-only polling operations (fetching comments/reviews), which don't mutate shim state.

**Test isolation via environment variables**: To support parallel test execution, shims should read their state file location from an environment variable (e.g., `E2E_STATE_DIR`). Each test creates its own temp directory and sets this env var before running. The shims then read/write state to `$E2E_STATE_DIR/gh_state.json` instead of a hardcoded location. This ensures tests don't interfere with each other when running in parallel.

### What the agent shim needs to do

The dispatcher checks completion by re-parsing `prloom/.local/plan.md` and verifying the target TODO is now marked done.

**Agent CLI invocation patterns** (how prloom calls each agent):

| Agent     | Command pattern                                          |
|-----------|----------------------------------------------------------|
| opencode  | `opencode run --model '<model>' "<prompt>"`              |
| claude    | `claude -p "<prompt>" --model '<model>' --dangerously-skip-permissions` |
| codex     | `codex exec "<prompt>" -m '<model>' --full-auto`         |
| gemini    | `gemini --model '<model>' --yolo "<prompt>"`             |

For E2E tests, only the `opencode` shim is typically needed (configure tests to use the `opencode` adapter).

So the minimal worker shim should:

1. find the active plan file at `./prloom/.local/plan.md` (relative to `cwd` passed to the adapter)
2. edit it to mark the first unchecked TODO as checked
3. modify at least one tracked file in the worktree so `commitAll()` actually creates a commit
   - example: append a line to `e2e.txt` that you also `git add` in that worktree
4. (optional) append a trace entry to the trace file for hook ordering assertions

Important: the shim should not call `git commit` itself; prloom does that.

**Trace file for hook ordering**: To assert hook ordering (`beforeTodo → worker → afterTodo`), the agent shim should write to the same trace file as the hooks. Since the shim runs with `cwd` set to the worktree, it can write to `./prloom/.local/e2e-trace.jsonl`:

```javascript
// In the opencode shim
const tracePath = path.join(process.cwd(), "prloom/.local/e2e-trace.jsonl");
fs.appendFileSync(tracePath, JSON.stringify({ hook: "worker", ts: new Date().toISOString() }) + "\n");
```

With lifecycle hooks, the agent shim becomes doubly useful:

- hooks can call `ctx.runAgent(...)` to re-write the plan
- your fake agent can be used as a deterministic “plan transformer” for hook tests

If you want to assert “plan context injection” (RFC), have the agent shim record the received prompt to a file and check that it contains the plan-format docs and the full current plan.

### Avoid tmux for E2E

E2E should set dispatcher options with `tmux: false` to avoid needing a tmux shim.

(There are separate unit tests around tmux detection/behavior; E2E’s job is the core workflow.)

## Concrete harness outline (Bun)

Create `tests/e2e/` with a small harness in `tests/e2e/harness.ts`:

### `makeTempRepo()`

Creates a temporary git repository for testing:

- creates `/tmp/prloom-e2e-<id>/repo`
- `git init`, initial commit with a dummy file (e.g., `README.md`)
- creates a local bare remote at `/tmp/prloom-e2e-<id>/remote.git`
- configures `origin` to the bare remote so `git push` works offline
- returns `{ repoRoot, remoteDir, cleanup }` where `cleanup()` removes the temp directory

The bare remote is required because `git worktree add` with `-b <branch> origin/<base>` needs a fetchable remote.

### `makeFakeBinaries(binDir: string, stateDir: string)`

Creates executable shim scripts:

- creates `<binDir>/gh` and `<binDir>/opencode`
- marks them executable (`chmod +x`)
- returns an env override: `{ PATH: \`${binDir}:${process.env.PATH}\`, E2E_STATE_DIR: stateDir }`

The `E2E_STATE_DIR` environment variable tells shims where to read/write their state files, enabling parallel test execution.

### Cleanup behavior

The harness should automatically clean up temp directories after each test. For debugging failed tests, set `const KEEP_TEMP_DIR = true` at the top of the harness file to preserve directories on failure.

### Worktrees directory

The `worktreesDir` parameter for `ingestInboxPlans` should use the default location resolved from config: `prloom/.local/worktrees` relative to the repo root. Use `resolveWorktreesDir(repoRoot, config)` from `src/lib/config.ts` to get the correct path.

The full directory structure after setup:

```
/tmp/prloom-e2e-<id>/
├── repo/                           # Main repository (repoRoot)
│   ├── README.md                   # Initial committed file
│   ├── plugins/                    # Test plugins (if testing hooks)
│   │   └── e2e-hooks/
│   │       └── index.js
│   └── prloom/
│       ├── config.json             # Test configuration
│       └── .local/
│           ├── inbox/              # Inbox plans (on base branch)
│           │   ├── <planId>.md     # Plan content
│           │   └── <planId>.json   # Plan metadata (status: "queued")
│           └── worktrees/          # Created worktrees (after ingestion)
│               └── <branch>/       # Individual worktree
│                   └── prloom/
│                       ├── .bus/
│                       │   └── actions.jsonl  # Bus outbox (if hooks emit actions)
│                       └── .local/
│                           ├── plan.md           # Copied plan (worker edits this)
│                           ├── state.json        # Per-worktree state
│                           └── e2e-trace.jsonl   # Hook trace file (if testing hooks)
├── remote.git/                     # Bare remote for offline push
├── bin/                            # Shim binaries
│   ├── gh
│   └── opencode
├── state/                          # Shim state files (E2E_STATE_DIR)
│   └── gh_state.json
└── logs/                           # Captured logs (optional)
    └── e2e.log
```

### State management

Use the existing state helpers from `src/lib/state.ts`:

- `setPlanStatus(repoRoot, planId, "queued")` to mark inbox plans as queued
- `loadState(repoRoot)` to get current state (scans worktrees and inbox)
- `saveState(repoRoot, state)` to persist state changes

To set up an inbox plan for testing:

```typescript
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { setPlanStatus, ensureInboxDir, getInboxPath } from "../src/lib/state";

// 1. Ensure inbox directory exists
ensureInboxDir(repoRoot);

// 2. Write the plan markdown file
const planId = "test-plan";
const planPath = getInboxPath(repoRoot, planId);
writeFileSync(planPath, `# Test Plan\n\n## TODO\n\n- [ ] First task\n`);

// 3. Mark it as queued (this creates the .json metadata file)
setPlanStatus(repoRoot, planId, "queued", "opencode");
```

### Logger setup

Create a logger that captures output for assertions:

```typescript
import { writeFileSync, appendFileSync } from "fs";
import { join } from "path";

function createTestLogger(logFile: string) {
  const logs: { level: string; msg: string; planId?: string }[] = [];
  
  const write = (level: string, msg: string, planId?: string) => {
    logs.push({ level, msg, planId });
    appendFileSync(logFile, JSON.stringify({ level, msg, planId }) + "\n");
  };

  return {
    logger: {
      info: (msg: string, planId?: string) => write("info", msg, planId),
      success: (msg: string, planId?: string) => write("success", msg, planId),
      warn: (msg: string, planId?: string) => write("warn", msg, planId),
      error: (msg: string, planId?: string) => write("error", msg, planId),
    },
    logs,
    getLogFile: () => logFile,
  };
}
```

### Hooks/plugins in the harness

To test lifecycle hooks without publishing npm packages, create a plugin module inside the temp repo and point `prloom/config.json` at it.

Example layout in the temp repo:

- `plugins/e2e-hooks/index.js` (or `.ts` compiled in test setup)

**Plugin export format**: A plugin is a factory function that receives config and returns an object of hooks:

```javascript
// plugins/e2e-hooks/index.js
const fs = require("fs");
const path = require("path");

module.exports = function plugin(config) {
  const appendTrace = (worktree, entry) => {
    const tracePath = path.join(worktree, "prloom/.local/e2e-trace.jsonl");
    fs.mkdirSync(path.dirname(tracePath), { recursive: true });
    fs.appendFileSync(tracePath, JSON.stringify({ ...entry, ts: new Date().toISOString() }) + "\n");
  };

  return {
    beforeTodo: async (plan, ctx) => {
      appendTrace(ctx.worktree, { hook: "beforeTodo", planId: ctx.planId });
      return plan;
    },
    afterTodo: async (plan, ctx) => {
      appendTrace(ctx.worktree, { hook: "afterTodo", planId: ctx.planId, todoCompleted: ctx.todoCompleted });
      return plan;
    },
    beforeFinish: async (plan, ctx) => {
      appendTrace(ctx.worktree, { hook: "beforeFinish", planId: ctx.planId });
      // Optionally add a TODO to prevent finishing:
      // return plan.replace("## TODO", "## TODO\n\n- [ ] Added by hook");
      return plan;
    },
    afterFinish: async (plan, ctx) => {
      appendTrace(ctx.worktree, { hook: "afterFinish", planId: ctx.planId });
      // Example: emit an action to the bus
      ctx.emitAction({ type: "notify", message: "Plan finished" });
      return plan;
    },
  };
};
```

**Hook signature**: Each hook is `(plan: string, ctx: HookContext) => Promise<string>`. The hook receives the current plan markdown and must return the (possibly modified) plan.

**HookContext properties**:
- `repoRoot: string` - Repository root path
- `worktree: string` - Worktree path for this plan
- `planId: string` - Plan identifier
- `hookPoint: string` - Current hook point name
- `changeRequestRef?: string` - PR number if applicable
- `todoCompleted?: string` - The completed TODO text (only for `afterTodo`)
- `runAgent(prompt, options?): Promise<string>` - Run an agent with plan context injection
- `emitAction(action): void` - Emit an action to the bus outbox

Example plugin behavior (test-only): see the code example above. The plugin appends trace entries for each hook point and demonstrates `ctx.emitAction()` in `afterFinish`.

This keeps the E2E test asserting:

- plugin loading works (module resolves and runs)
- hook ordering works
- hook side effects work (plan mutation, action emission)

### Test flow (one tick)

Then in the test:

1. Set up the temp repo with `makeTempRepo()` and shims with `makeFakeBinaries(binDir, stateDir)`
2. **Set environment variables before calling dispatcher functions**:
   ```typescript
   const originalEnv = { ...process.env };
   process.env.PATH = `${binDir}:${process.env.PATH}`;
   process.env.E2E_STATE_DIR = stateDir;
   // ... run test ...
   // Restore in afterEach/finally:
   process.env = originalEnv;
   ```
3. Write `prloom/config.json` selecting the `opencode` adapter, setting `plugins`, and enabling/disabling GitHub as needed
4. Write an inbox plan to `prloom/.local/inbox/<id>.md` and mark it queued using `setPlanStatus(repoRoot, planId, "queued", "opencode")`
5. Load state with `loadState(repoRoot)` and resolve worktrees dir with `resolveWorktreesDir(repoRoot, config)`
6. Call `ingestInboxPlans(repoRoot, worktreesDir, config, state, log, { tmux: false })`
7. Call `processActivePlans(repoRoot, config, state, botLogin, { tmux: false }, log)`
8. Assert on:
   - `state.plans[planId].worktree`, `.branch`, optional `.pr`
   - `git log --oneline` includes the TODO text
   - hook trace file ordering (if hooks enabled)
   - if hooks emit actions: `prloom/.bus/actions.jsonl` has the expected action(s)
   - if GitHub enabled: `gh` shim state file (`$E2E_STATE_DIR/gh_state.json`) shows create/edit/ready calls were made
   - log file contains expected entries

## What would need changing in the codebase (optional, but nice)

You can do E2E with PATH shims today, but a couple small changes would make it cleaner:

1. **Expose a single-iteration dispatcher helper**
   - e.g. `runDispatcherOnce()` that executes exactly one loop body
   - this avoids tests needing to manually call `ingestInboxPlans` and `processActivePlans` in the right order
2. **Inject a command runner**
   - wrap `execa` behind a small interface (e.g. `run(cmd, args, opts)`)
   - allows easy mocking without PATH tricks

With lifecycle hooks, `runDispatcherOnce()` becomes even more valuable, because it lets E2E tests exercise hook points in a controlled single-step execution.

## CI considerations

The E2E tests use shell scripts (with `#!/usr/bin/env node` shebangs) for the `gh` and agent shims. This works reliably on both macOS and Linux CI environments. The shims should be written as Node.js scripts to ensure consistent behavior across platforms.

## Suggested first E2E test cases

1. `e2e/local_only_happy_path.test.ts`
   - GitHub disabled; verifies ingestion + one TODO completion + commit
2. `e2e/github_enabled_happy_path.test.ts`
   - GitHub enabled; verifies `gh pr create/edit/ready` behavior using shims
3. `e2e/hooks_ordering.test.ts`
   - GitHub disabled; plugin enabled; asserts hook ordering via trace file
4. `e2e/hooks_before_finish_can_block.test.ts`
   - GitHub enabled or disabled; `beforeFinish` adds TODO; asserts plan does not finish

All should run fast and fully offline.
