# Adapters

Adapters are the interface between prloom and coding agents. Each adapter wraps a CLI tool.

## Available Adapters

| Adapter | CLI | Location |
|---------|-----|----------|
| `opencode` | `opencode` | `src/lib/adapters/opencode.ts` |
| `claude` | `claude` | `src/lib/adapters/claude.ts` |
| `codex` | `codex` | `src/lib/adapters/codex.ts` |
| `gemini` | `gemini` | `src/lib/adapters/gemini.ts` |
| `manual` | (none) | `src/lib/adapters/manual.ts` |

## Interface

All adapters implement `AgentAdapter` from `src/lib/adapters/types.ts`:

```typescript
interface AgentAdapter {
  execute(options: ExecutionOptions): Promise<ExecutionResult>;
}

interface ExecutionOptions {
  cwd: string;           // Working directory (worktree)
  prompt: string;        // The prompt to send
  model?: string;        // Model override
  tmux?: { sessionName: string };  // Run in tmux session
}

interface ExecutionResult {
  exitCode?: number;
  pid?: number;          // For detached processes
  tmuxSession?: string;  // For tmux sessions
}
```

## Execution Modes

Adapters can run in two modes:

1. **Tmux mode** - Spawns in a named tmux session. Allows observation. Exit code written to `/tmp/prloom-<session>/exit_code`.

2. **Detached mode** - Spawns a background process. Tracked by PID.

The dispatcher waits for completion before proceeding.

## Adding a New Adapter

1. Create `src/lib/adapters/<name>.ts`
2. Implement `AgentAdapter` interface
3. Add to `adapters` map in `src/lib/adapters/index.ts`
4. Add type to `AgentName` union in `src/lib/adapters/types.ts`

## Manual Adapter

The `manual` adapter is special - it does nothing. Used when a human handles the work. Plans with `agent: manual` skip automated TODO execution.
