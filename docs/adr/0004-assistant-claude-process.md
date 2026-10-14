---
status: accepted
date: 2026-10-13
---

# Run the Assistant as one long-lived `claude` process per Change

## Context and Problem Statement

The Assistant runs on the Reviewer's own installed `claude` CLI, so it uses whichever Claude login that machine has (`docs/research/claude-subscription-auth-macos.md`). It gives a summary when a Change opens, and later tickets add a chat per Change, Findings and Brief writing, all in the same conversation. A Change's worktrees hold code written by other people, which can include a `.claude/settings.json` with hooks or a `.mcp.json`. How should Dear Reviewer run `claude` for a Change?

## Considered Options

- One long-lived `claude -p` process per Change, with stream-json input and output
- A new `claude -p` process for each turn, resuming the session with `--resume`
- The Claude Agent SDK, with its bundled `claude` binary

## Decision Outcome

Chosen option: one long-lived process per Change, because every later feature is another turn in the same conversation, and the process gives each turn's reply as it streams.

- The process starts when the Change's diff is shown in a window and stops when the Change is closed. Its working directory is the head worktree, and the base worktree is added with `--add-dir`. ADR 0009 changes this: `claude` runs in a folder of the conversation's own, with both worktrees added, and starts with the conversation's first turn.
- Tools are limited to `Read`, `Grep` and `Glob` (`--tools` and `--allowedTools`), with `--permission-mode dontAsk`, so the Assistant never prompts, never runs commands and never edits files.
- `--setting-sources user` and `--strict-mcp-config` keep a worktree's own Claude settings, hooks and MCP servers from loading.
- The environment is the extension host's, without `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDECODE` or any `CLAUDE_CODE_USE_*` variable. `claude auth status` runs in the same environment, and its login method is shown to the Reviewer.
- The path to `claude` is read only from user settings, so a workspace can't choose the program Dear Reviewer runs.
- `src/assistant/claude.ts` owns this. A conversation's `ask(prompt, onText)` is one turn; turns queue.

### Consequences

- Good, because chat, Findings and the Brief writer reuse the same process and conversation without restarting `claude` for each turn.
- Good, because opening a pull request's code can't run its hooks or MCP servers inside the Assistant.
- Bad, because each open Change keeps a `claude` process running, even when the Reviewer isn't using its Assistant.
- Bad, because the conversation ends when the window closes or reloads. Keeping one Claude session per Change across Reviews, as the spec asks, needs the session id stored and `--resume` passed, which ADR 0009 adds.
- Bad, because `--setting-sources user` also skips the Reviewer's own project-level Claude settings for that repository.
