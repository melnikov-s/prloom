# RFC: Lifecycle Hooks & Plugins

**Status:** Proposal
**Author:** prloom team
**Created:** 2026-01-09

---

## Summary

prloom supports **lifecycle hooks** at key points during plan execution. Hooks are functions that receive the plan, can modify it, and return the updated plan.

**Plugins** are collections of hooks with configuration, shareable as npm packages.

---

## Design Goals

1. **Plan is the artifact** — hooks receive and return the plan
2. **Hooks can do anything** — run tests, call agents, modify code
3. **Simple contract** — `(plan, ctx) => plan`
4. **Configurable plugins** — plugins receive config and return hooks

---

## Hook Points

| Hook           | When                        | Example Use                  |
| -------------- | --------------------------- | ---------------------------- |
| `afterDesign`  | After designer creates plan | Validation, custom sections  |
| `beforeTodo`   | Before starting a TODO      | Pre-checks, setup            |
| `afterTodo`    | After completing a TODO     | Run tests, lint              |
| `beforeFinish` | Before marking plan ready   | Review council, final checks |
| `afterFinish`  | After plan is marked ready  | Notifications, cleanup       |

---

## Hook Context

Hooks receive context tied to prloom's configuration:

```ts
export type HookContext = {
  repoRoot: string;
  worktree: string;
  planId: string;
  hookPoint: string;
  changeRequestRef?: string; // PR number if applicable

  // Run agent using configured adapter, tracked as part of this plan's session
  runAgent: (prompt: string, files?: string[]) => Promise<string>;

  // Emit action to outbox for bridge delivery (e.g., post GitHub comment)
  emitAction: (action: Action) => void;

  // Specific to hook point
  todoCompleted?: string; // afterTodo
};

export type Hook = (plan: string, ctx: HookContext) => Promise<string>;
```

**Blocking during execution:** While a hook is executing, the plan is blocked—no polling, no worker execution. This ensures hooks have exclusive access.

**Why `runAgent`?** Uses prloom's configured adapter and associates sessions with the plan ID.

**Why `emitAction`?** Allows hooks to trigger external actions (post comment, submit review) via the File Bus. Bridges handle delivery.

> **Dependency:** `emitAction` requires the File Bus to be implemented first.

---

## Plugins

A plugin is a function that takes config and returns hooks:

```ts
// plugins/quality-gates/index.ts
export type Config = {
  testCommand: string;
  lintCommand: string;
  failOnWarnings: boolean;
};

export default function plugin(config: Config) {
  return {
    afterTodo: async (plan: string, ctx: HookContext) => {
      const { exitCode, stderr } = await ctx.exec(config.testCommand);
      if (exitCode !== 0) {
        return plan + `\n- [ ] Fix test failures:\n\`\`\`\n${stderr}\n\`\`\``;
      }
      return plan;
    },

    beforeFinish: async (plan: string, ctx: HookContext) => {
      const { exitCode } = await ctx.exec(config.lintCommand);
      if (exitCode !== 0 && config.failOnWarnings) {
        return plan + `\n- [ ] Fix lint warnings`;
      }
      return plan;
    },
  };
}
```

---

## Configuration

### Global Config (repo root)

```json
{
  "plugins": {
    "quality-gates": {
      "module": "./plugins/quality-gates",
      "config": { "testCommand": "npm test" }
    },
    "review-council": {
      "module": "prloom-plugin-review-council",
      "config": { "minReviewers": 3 }
    }
  },
  "pluginOrder": ["quality-gates", "review-council"],

  "presets": {
    "default": {},
    "quick": {
      "plugins": {
        "review-council": { "enabled": false }
      }
    },
    "thorough": {
      "plugins": {
        "review-council": { "config": { "minReviewers": 5 } }
      }
    }
  }
}
```

### Per-Plan Config (worktree)

Each worktree can override global config:

```
<worktree>/prloom/config.json
```

```json
{
  "plugins": {
    "review-council": { "enabled": false }
  }
}
```

### Presets

- Presets are **additive** — they merge with global config
- Presets are **per-repo** — defined in repo's global config
- **Default preset** is used if none specified

**Usage:**

```bash
prloom new "simple fix" --preset quick
```

**TUI:** User selects preset from a list during `prloom new`.

### Config Resolution

```
Global plugins → Preset overrides → Worktree config → Final merged config
```

---

## Plugin Loading

```ts
async function loadPlugins(config: Config): Promise<HookRegistry> {
  const registry: HookRegistry = {};

  // Load in specified order
  for (const name of config.pluginOrder) {
    const def = config.plugins[name];
    if (!def || def.enabled === false) continue; // Skip disabled

    const pluginModule = await import(def.module);
    const hooks = pluginModule.default(def.config);

    // Merge hooks into registry
    for (const [hookPoint, hook] of Object.entries(hooks)) {
      registry[hookPoint] ??= [];
      registry[hookPoint].push(hook);
    }
  }

  return registry;
}
```

---

## Example: Review Council Plugin

```ts
// prloom-plugin-review-council/index.ts
export type Config = {
  minReviewers: number;
  model?: string;
};

export default function plugin(config: Config) {
  return {
    beforeFinish: async (plan: string, ctx: HookContext) => {
      const reviews = await Promise.all(
        Array(config.minReviewers)
          .fill(null)
          .map(() => ctx.runAgent(`Review this completed plan:\n${plan}`))
      );

      const issues = reviews.flatMap((r) => extractIssues(r));
      if (issues.length === 0) {
        return plan; // Approved
      }

      return (
        plan +
        `\n## Council Feedback\n${issues.map((i) => `- [ ] ${i}`).join("\n")}`
      );
    },
  };
}
```

---

## Execution Model

1. Dispatcher reaches hook point
2. Collects all hooks for that point (from all plugins)
3. Runs hooks in sequence, passing plan through
4. Uses final returned plan

```ts
async function runHooks(
  hookPoint: string,
  plan: string,
  ctx: HookContext
): Promise<string> {
  const hooks = registry[hookPoint] ?? [];
  for (const hook of hooks) {
    plan = await hook(plan, ctx);
  }
  return plan;
}
```

---

## Design Decisions

1. **Hook ordering**: Plugins are an array; hooks run in declaration order.

2. **Error handling**: If a hook throws, **abort**. Plugins can use try-catch internally if they want to continue gracefully.

3. **External actions**: Hooks use `emitAction()` to trigger external actions (GitHub comments, etc.). Actions go to the outbox; bridges handle delivery.

4. **Blocking**: While a hook executes, the plan is blocked (no polling, no worker execution).

---

## Implementation Order

1. **File Bus first** — Implements outbox.jsonl and bridges for `emitAction()` to work
2. **Hooks second** — Implements plugin system with full functionality
3. **Migrate review** — Move review agent to a `beforeFinish` hook
