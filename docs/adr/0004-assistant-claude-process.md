---
status: accepted
date: 2026-10-13
---

# Run the Assistant as one long-lived `claude` process per Change

Amended by [ADR 0042](0042-one-prompt-security-policy.md): `--allowedTools` lists the git tools only, not `Read`, `Grep` and `Glob`, and `--setting-sources` is empty, not `user`, so the Assistant reads only in its working folder and the `--add-dir` folders, and no user, project or local Claude Code settings file loads, the Reviewer's own included.

Amended by [ADR 0019](0019-change-overview.md): the summary is one short paragraph shown in the Change's overview, and the Assistant's panel opens only when the Reviewer asks.

Amended by [ADR 0030](0030-read-only-git-tools-for-the-assistant.md): `claude` also gets Dear Reviewer's own git server through `--mcp-config`, beside `--strict-mcp-config`, and `--allowedTools` adds its four read-only git tools. The Assistant still has no shell.

## Context and Problem Statement

The Assistant runs on the Reviewer's own installed `claude` CLI, so it uses whichever Claude login that machine has (`docs/research/claude-subscription-auth-macos.md`). It gives a summary when a Change opens, and later tickets add a chat per Change, Findings and Brief writing, all in the same conversation. A Change's worktrees hold code written by other people, which can include a `.claude/settings.json` with hooks or a `.mcp.json`. How should Dear Reviewer run `claude` for a Change?

## Considered Options

- One long-lived `claude -p` process per Change, with stream-json input and output
- A new `claude -p` process for each turn, resuming the session with `--resume`
- The Claude Agent SDK, with its bundled `claude` binary

## Decision Outcome

Chosen option: one long-lived process per Change, because every later feature is another turn in the same conversation, and the process gives each turn's reply as it streams.

The Agent SDK lost even though it runs on a subscription login too. It starts its own bundled copy of `claude` over the same stream-json transport, so it saves plumbing but adds nothing the CLI can't do. Its docs say that, unless Anthropic approves it, third-party products built on the SDK must not offer claude.ai login and should use API keys instead. Anthropic's legal page allows a user signing in to their own unmodified `claude`, which is what Dear Reviewer runs. If Dear Reviewer adds an API key mode, the SDK is worth looking at again. See `docs/research/claude-subscription-auth-macos.md`, sections 1 and 2.

- The process starts when the Change's diff is shown in a window and stops when the Change is closed. Its working directory is the head worktree, and the base worktree is added with `--add-dir`. ADR 0009 changes this: `claude` runs in a folder of the conversation's own, with both worktrees added, and starts with the conversation's first turn.
- Tools are limited to `Read`, `Grep` and `Glob` (`--tools` and `--allowedTools`), with `--permission-mode dontAsk`, so the Assistant never prompts, never runs commands and never edits files.
- `--setting-sources user` and `--strict-mcp-config` keep a worktree's own Claude settings, hooks and Model Context Protocol (MCP) servers from loading.
- The environment is built from a list of the extension host's variables that `claude` needs to find itself, its login and the network: `PATH`, `HOME`, `CLAUDE_CONFIG_DIR`, `USER`, `LOGNAME`, `SHELL`, `TMPDIR`, `LANG`, `LC_*`, `TERM`, the proxy variables in either case and `NODE_EXTRA_CA_CERTS`. Nothing else reaches it, so no `ANTHROPIC_*` or `CLAUDE_CODE_*` variable can make it bill an API key or a cloud provider, or send its requests elsewhere. `claude auth status` runs in the same environment, and its login method is shown to the Reviewer.
- The path to `claude` is read only from user settings, so a workspace can't choose the program Dear Reviewer runs.
- `src/assistant/claude.ts` owns this. A conversation's `ask(prompt, onText)` is one turn; turns queue.

### Consequences

- Good, because chat, Findings and the Brief writer reuse the same process and conversation without restarting `claude` for each turn.
- Good, because opening a pull request's code can't run its hooks or MCP servers inside the Assistant.
- Bad, because each open Change keeps a `claude` process running, even when the Reviewer isn't using its Assistant.
- Bad, because the conversation ends when the window closes or reloads. Keeping one Claude session per Change across Reviews, as the spec asks, needs the session id stored and `--resume` passed, which ADR 0009 adds.
- Bad, because a variable `claude` needs that isn't on the list, such as one a proxy or certificate setup of its own reads, has to be added to it.
- Bad, because `--setting-sources user` also skips the Reviewer's own project-level Claude settings for that repository.
