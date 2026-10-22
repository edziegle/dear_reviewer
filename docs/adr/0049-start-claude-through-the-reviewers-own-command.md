---
status: accepted
date: 2026-10-22
---

# Start the Assistant's `claude` through the Reviewer's own command

## Context and Problem Statement

Many organizations let Claude Code run only inside a sandbox of their own: a container, a virtual machine, a launcher script or a remote host. Each does it its own way. Dear Reviewer starts `claude` itself (ADR 0004), and the Claude Path setting names one executable with no arguments, so a Reviewer in such an organization can use the Assistant only by writing a wrapper script, and nothing says what that script must do (issue #178).

Inside a sandbox that runs `claude` in a container or on another machine, Dear Reviewer's git server (ADR 0030) can't start: `claude` starts it from `--mcp-config`, on VS Code's own binary at its path on the Reviewer's machine, which the sandbox doesn't have or can't run. `claude` carries on without the git tools, and the role prompt still promises them. How should a Reviewer choose how `claude` starts, and what should happen when the git tools don't?

## Considered Options

- A command setting: a list of strings, the program and then its arguments
- A command setting as one string, split as a shell splits words
- Claude Path as it is, with wrapper scripts documented
- A provider for each kind of sandbox (issue #109)

## Decision Outcome

Chosen option: a list of strings, because Dear Reviewer runs it without a shell, so nothing needs quoting and nothing in a Change can reach a shell, and because one setting covers both a custom command and a script. One string needs quoting rules, which break on paths with spaces. Claude Path as it is makes every command with arguments a script. A provider for each sandbox puts knowledge of each sandbox in Dear Reviewer, and there are too many.

- **The setting.** `dearReviewer.claudeCommand`, Claude Command, is a list of strings, machine-scoped and read only from user settings, as Claude Path is, so a workspace can't choose what runs. Its first item is the program: a path, with `~` expanded, or a bare name looked up on the PATH. Dear Reviewer adds its own arguments after the list. An empty list finds `claude` as before.
- **Claude Path.** It is deprecated and still read: when Claude Command is empty and Claude Path has a value, the value is a command of one item. Removing it is a later change.
- **Every run.** `claude auth status` and each conversation start through the command, so the login check sees the same `claude` the Assistant runs.
- **Environment.** The command gets the allow-listed environment of ADR 0004 and nothing more. A command that needs other variables, such as `DOCKER_HOST`, is a script that sets them. A second setting naming variables to pass would let an organization pass `CLAUDE_CODE_*` variables, which ADR 0004 keeps out, and VS Code started from the Dock on macOS doesn't have the shell's variables to pass anyway.
- **What the command must do.** `docs/custom-claude-command.md`, linked from the setting's description, says so and gives an example script: pass the arguments, standard input and standard output through unchanged; run `claude` in the folder the command started in; see Dear Reviewer's storage folder at the same path, as it holds the conversation folders, the worktrees and the Assistant folders; and let `claude` write its config folder, since `--resume` needs the saved sessions (ADR 0009).
- **Missing git tools.** The role prompt promises the git tools only if they are among the Assistant's tools: if not, they didn't start, and the Assistant says it can't look up older history rather than guessing. `claude` reports its MCP servers in the `init` event, which comes only with the first message, after the summary prompt has been sent, so the prompt can't be chosen from it. Dear Reviewer reads the `init` event's `mcp_servers`, and when the git server isn't connected, the Assistant panel says so for that conversation, with a link to the guide. A git server that fails without a custom command gets the same.

### Consequences

- Good, because a Reviewer whose organization sandboxes Claude Code can use the Assistant, and Dear Reviewer knows nothing about any sandbox.
- Good, because the Assistant still has no shell and its environment stays allow-listed.
- Bad, because in the Settings UI a list gets only "Edit in settings.json", not a text box.
- Bad, because most custom commands lose the git tools, and with them history older than the Change.
- Bad, because whether the Assistant notices its git tools are missing rests on the model reading its tool list.
- Bad, because a command that needs more variables than ADR 0004 passes must be a script.
