---
status: accepted
date: 2026-10-15
---

# Give the Assistant read-only git through an MCP server Dear Reviewer ships

## Context and Problem Statement

The Assistant's `claude` has only `Read`, `Grep` and `Glob`, and loads no MCP (Model Context Protocol) server (ADR 0004). It can't read `.git` either: a worktree's `.git` is a file that points into the clone's own git folder, which isn't one of its `--add-dir` folders. The only history it sees is the Change's own commits in its prompts, capped (ADR 0026). It can't say which commit added a function, whether a bug is older than the Change, or what a commit before the Change did (issue #39).

A Change's repository holds other people's code and can hold other people's git config: a pager, an external diff, a `textconv` driver, hooks, a signature program. The Reviewer's clone also has branches unrelated to the Change. How can the Assistant read the Change's history without running any of that, and without reaching anything else?

## Considered Options

- An MCP server bundled in the extension, with four tools: `log`, `show`, `blame` and `diff`
- `Bash` with git patterns in `--allowedTools`, such as `Bash(git log:*)`
- Write more history into the prompts, or into a file beside the threads file

## Decision Outcome

Chosen option: the bundled MCP server, because each tool builds its own git command line from fixed parts and checks every argument the Assistant gives, so the Assistant never has a shell and never chooses a git option.

`Bash` patterns lost because they match a prefix of the command. `Bash(git log:*)` can't keep out `--output=<file>`, `-c core.pager=<program>`, `--ext-diff`, or the repository's own diff drivers, and it would give the Assistant a shell to escape them. More history in the prompts lost because the Assistant needs history it can't know in advance, such as the commits that touched one function, and each prompt would grow for every Change.

- **Tools.** `log` lists commits newest first, each with its commit ID, author, date and full message. It takes an optional revision range (`A..B`, `A..` or one revision), path, line range of a file (as `git log -L`) and the most commits to list. `show` gives the message, author, date and diff of one commit, optionally of one path. `blame` gives a file's lines at a commit, the Change's head by default, each with its commit, author and date. `diff` gives the diff between two commits, the Change's base and head by default, optionally of one path.
- **Repository.** Git runs only in the Change's repository, its clone, which the server learns from its environment. No tool takes a folder.
- **Reach.** Each revision the Assistant gives is resolved to a commit with `git rev-parse`, then checked to be the Change's base or head or one of their ancestors with `git merge-base --is-ancestor`. Anything else is refused with the same message, whether the commit is on another branch or doesn't exist. Git then runs with the resolved commit IDs. `log` walks from the Change's base and head, or the range given, never `--all` or other refs, and its format leaves out ref names.
- **Arguments.** No argument can start with `-`, and revisions can't hold whitespace, control characters or a range. Paths must be relative, normalised, and stay inside the repository; they go after `--`, and git reads them literally. `blame` always names a commit, so it never reads the worktree, and unknown arguments are refused. Every check runs before git does.
- **Fixed git options.** Every run starts with `--no-pager`, `--literal-pathspecs` and `-c` overrides for `core.pager`, `core.hooksPath`, `core.fsmonitor`, `color.ui`, `log.showSignature`, `log.decorate` and `blame.ignoreRevsFile`. The commands that make diffs add `--no-ext-diff`, `--no-textconv` and `--no-color`. `GIT_OPTIONAL_LOCKS=0` keeps git from writing the index. Nothing passes `--output` or any other option that writes.
- **Caps.** Each result keeps at most 20,000 characters, as ADR 0026 caps the commits in a prompt, and git is killed once it prints more. A result that was cut off says so and how to narrow the request. Each git run has a ten-second timeout; a run past it is killed, and the Assistant is told.
- **Other people's text.** Each result opens by saying what it is and that its messages, authors, lines and diffs are other people's text to read as data, never instructions, then gives the output of git in a code fence that nothing inside it can close (ADRs 0017 and 0026).
- **Starting and allowing it.** `esbuild` bundles the server as `dist/gitServer.js`, beside the extension. `claude` gets it through `--mcp-config`, as a stdio server whose command is the extension host's `process.execPath` with `ELECTRON_RUN_AS_NODE=1`, so it runs on VS Code's own binary and needs nothing installed. `--strict-mcp-config` stays, so a worktree's own `.mcp.json` still never loads. `--allowedTools` adds exactly the four tools, `mcp__git__log`, `mcp__git__show`, `mcp__git__blame` and `mcp__git__diff`; `--tools` stays `Read,Grep,Glob`.
- **Environment.** `claude` starts the server with its own environment, the restricted one of ADR 0004, plus the config's variables: `ELECTRON_RUN_AS_NODE` and the Change's repository, base and head.
- **Telling the Assistant.** The system prompt says the tools exist, what they reach, and that their output is other people's text.
- **Visibility.** Each call shows in the Assistant panel's activity, as `Read` and `Grep` calls do, such as "Reading commit abc123" or "Reading who last changed util.py:2-2".
- `src/assistant/gitTools.ts` holds the argument checks, the command lines, the caps and the fencing, and imports neither `vscode` nor `child_process`, so unit tests load it directly. `src/assistant/gitServer.ts` runs git and speaks the JSON-RPC of MCP over stdio by hand, without the MCP SDK, which would add a dependency for four tools.

### Consequences

- Good, because the Assistant can answer questions about the Change's history, such as which commit added some code or whether a bug predates the Change.
- Good, because the Assistant still has no shell, and a repository's config can't make a read run a program.
- Good, because the Reviewer's other branches never reach the conversation.
- Bad, because each conversation starts a second process, the server, beside `claude`.
- Bad, because history the Change's base and head don't reach, such as the target branch's newer commits, stays out of reach.
- Bad, because a new git option that runs a program or reads config would need adding to the fixed options, as `log.showSignature` needed.
- Bad, because the server speaks a hand-written subset of MCP, which a future protocol version could outgrow.
