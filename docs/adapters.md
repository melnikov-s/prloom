# Adapters

Adapters are the interface between prloom and coding agents. Each adapter wraps a CLI tool.

## Available Adapters

| Adapter | CLI | Location |
|---------|-----|----------|
| `opencode` | `opencode` | `src/lib/adapters/opencode.ts` |
| `claude` | `claude` | `src/lib/adapters/claude.ts` |
| `codex` | `codex` | `src/lib/adapters/codex.ts` |
| `gemini` | `gemini` | `src/lib/adapters/gemini.ts` |

## Interface

All adapters implement `AgentAdapter` from `src/lib/adapters/types.ts`:

```typescript
interface AgentAdapter {
  name: AgentName;

  execute(opts: {
    cwd: string;            // Working directory (worktree)
    prompt: string;         // Prompt to send
    tmux?: { sessionName: string }; // Optional tmux session
    model?: string;         // Model override
  }): Promise<ExecutionResult>;

  interactive(opts: {
    cwd: string;            // Working directory
    prompt?: string;        // Optional prompt
    model?: string;         // Model override
  }): Promise<void>;
}

interface ExecutionResult {
  exitCode?: number;        // Set when process completes
  pid?: number;             // Detached process PID
  tmuxSession?: string;     // tmux session name
}
```

## Execution Modes

Adapters can run in two modes:

1. **Tmux mode** - Spawns a named tmux session for observation. Logs and exit codes land in `/tmp/<session>/worker.log` and `/tmp/<session>/worker.exitcode` (prompt at `/tmp/<session>/worker.prompt`).

2. **Detached mode** - Spawns a background process, tracked by PID. Adapters still write the prompt to `/tmp/<session>/worker.prompt`, but logging is adapter-specific.

The dispatcher waits for completion before proceeding.

## Adding a New Adapter

1. Create `src/lib/adapters/<name>.ts`
2. Implement `AgentAdapter` interface
3. Add to `adapters` map in `src/lib/adapters/index.ts`
4. Add type to `AgentName` union in `src/lib/adapters/types.ts`
5. Register model config in `src/lib/config.ts` (`AgentsConfig`)
