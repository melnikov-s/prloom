# RFC: Per-Plan Configuration

**Status:** Proposal
**Author:** prloom team
**Created:** 2026-01-09

---

## Summary

Plans can override global configuration via **presets** (predefined config bundles) and **worktree config files**. This enables different behaviors per plan without changing global settings.

---

## Design Goals

1. **Per-plan flexibility**: Different plans can have different plugin/feature settings
2. **Minimal config maintenance**: Presets capture common patterns
3. **Additive overrides**: Override specific values, inherit the rest
4. **CLI and TUI support**: Easy to select preset during `prloom new`

---

## Configuration Hierarchy

```
Global Config → Preset Overrides → Worktree Config → Final Config
```

Each layer merges additively with the previous.

---

## Global Config (repo root)

```json
// prloom/config.json
{
  "github": {
    "enabled": true
  },
  "plugins": {
    "quality-gates": {
      "module": "./plugins/quality-gates",
      "config": {
        "testCommand": "npm test",
        "lintCommand": "npm run lint"
      }
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
    "local-only": {
      "github": { "enabled": false },
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

Now `plugins` has the same schema everywhere—presets are just partial overrides.

---

## Presets

Presets are named config bundles that can be selected when creating a plan.

### Properties

- **Additive**: Presets merge with global config, not replace
- **Per-repo**: Defined in the repo's `prloom/config.json`
- **Default**: `"default"` preset is used if none specified (can be empty `{}`)

### Built-in Preset Ideas

| Preset       | Effect                             |
| ------------ | ---------------------------------- |
| `default`    | Use global config as-is            |
| `quick`      | Disable review, fast tests         |
| `local-only` | No GitHub integration at all       |
| `thorough`   | Full review council, strict checks |

### Disabling a Plugin

To disable a plugin in a preset, set `enabled: false`:

```json
{
  "presets": {
    "quick": {
      "plugins": {
        "review-council": { "enabled": false }
      }
    }
  }
}
```

The plugin is still defined globally but won't run for plans using this preset.

---

## Worktree Config

Each worktree can have its own config override:

```
<worktree>/prloom/config.json
```

```json
{
  "github": {
    "enabled": false
  },
  "plugins": {
    "review-council": { "minReviewers": 10 }
  }
}
```

This is written when:

1. User selects a preset during `prloom new`
2. User manually edits the file

---

## UX

### CLI

```bash
# Select preset
prloom new "simple fix" --preset quick

# Default preset (if not specified)
prloom new "feature work"
```

### TUI

During `prloom new`, show preset selection:

```
? Select configuration preset:
  > default (standard workflow)
    quick (no review, fast tests)
    local-only (no GitHub integration)
    thorough (full council review)
```

### Manual Override

User can always edit `<worktree>/prloom/config.json` after creation.

---

## Config Resolution

```ts
function resolveConfig(globalConfig, presetName, worktreeConfig) {
  const preset = globalConfig.presets[presetName] ?? {};

  // Deep merge: global → preset → worktree
  return deepMerge(globalConfig, preset, worktreeConfig);
}
```

---

## What Can Be Overridden?

| Setting                    | Override? | Example                    |
| -------------------------- | --------- | -------------------------- |
| `github.enabled`           | ✅ Yes    | Disable GitHub entirely    |
| `plugins.<name>.enabled`   | ✅ Yes    | Disable specific plugin    |
| `plugins.<name>.<setting>` | ✅ Yes    | Override plugin settings   |
| `bus.tickIntervalMs`       | ✅ Yes    | Change tick rate           |
| `agent.model`              | ✅ Yes    | Different model per plan   |
| `agent.adapter`            | ✅ Yes    | Different adapter per plan |

---

## GitHub Integration

The `github.enabled` flag controls **all** GitHub functionality:

| Operation               | Affected by `github.enabled: false` |
| ----------------------- | ----------------------------------- |
| Create PR               | ✅ Skipped                          |
| Mark PR ready           | ✅ Skipped                          |
| Update PR body          | ✅ Skipped                          |
| GitHub bridge (events)  | ✅ Disabled                         |
| GitHub bridge (actions) | ✅ Disabled                         |

When GitHub is disabled, the plan runs entirely locally.

---

## Design Decisions

1. **Everything is overridable**: All config values (including agent model/adapter) can be overridden per plan.

2. **No preset inheritance**: Presets don't extend other presets. Copy/paste if needed.

3. **Missing plugin config ignored**: If a preset references a plugin that doesn't exist, the override is silently ignored.

4. **Deep merge strategy**: Config layers merge additively. Later layers override earlier layers for the same keys.
