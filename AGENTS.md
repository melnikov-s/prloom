# Agent Guide

For background and motivation, see [README.md](README.md).

## Testing

**TDD is required.** Write tests before implementation.

```bash
bun test                    # run all tests
bun test tests/unit/foo     # run specific test file
```

### Mocking Policy

Only mock **external services**, never internal modules:

- GitHub API (`src/lib/github.ts`) - mock the API calls
- File system - use temp directories in `/tmp` (see existing tests)
- Tmux/shell - mock the adapter layer

Internal modules (config, state, resolver, etc.) should use real implementations in tests.

## Key Documentation

Read these when working on related areas:

| Area | Document |
|------|----------|
| Architecture & design | [docs/architecture.md](docs/architecture.md) |
| Plan lifecycle & workflow | [docs/workflows.md](docs/workflows.md) |
| Adapters (claude, opencode, etc.) | [docs/adapters.md](docs/adapters.md) |
| Event bus system | [docs/bus.md](docs/bus.md) |



## Project Structure

```
src/
  cli/          # CLI commands (yargs)
  lib/
    adapters/   # Agent adapters (claude, opencode, manual, etc.)
    bus/        # Event bus system (bridges, runner, registry)
tests/
  unit/         # Unit tests
  fixtures/     # Test fixtures
```

## Non-Obvious Things

- **Prompts are generated**: Run `bun run gen:prompts` before tests. The build script does this automatically.
- **Worktrees are external**: Plans run in separate git worktrees, not in the main repo.
- **Plan state lives in metadata files**: Inbox plans use `prloom/.local/inbox/<id>.json`, active plans use `prloom/.local/state.json`. Plan markdown has no frontmatter.
