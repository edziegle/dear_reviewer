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

- **Tools.** `log` lists commits newest first, each with its commit ID, author, date and full message. It takes an optional revision range (`A..B`, `A..` or one revision), path, line range of a file (as `git log -L`) and the most commits to list. `show` gives the message, author, date and diff of one commit, optionally limiting the diff to one path; the message, author and date come whole even when the commit didn't touch the path. `blame` gives a file's lines at a commit, the Change's head by default, each with its commit, author and date. `diff` gives the diff between two commits, the Change's base and head by default, optionally of one path.
- **Repository.** Git runs only in the Change's repository, its clone, which the server learns from its environment. No tool takes a folder.
- **Revisions.** A revision is a commit ID, full or abbreviated to at least 7 hex digits, or `base` or `head` for the Change's own, followed by any `~N` and `^N`. Nothing else is taken: no branch, tag or other ref name, no earlier position of a ref such as `@{1}`, no search such as `:/text` or `^{/text}`, no peel and no path. Each of those could tell of refs and commits outside the Change's history, even when the commit it ends at is inside it, so each gets the same refusal, without looking at the repository.
- **Reach.** A commit ID of the same length as the Change's own, 40 hex digits for SHA-1 or 64 for SHA-256, is taken whole; a shorter one is an abbreviation, and a longer one is refused, since git would read it as a ref name. An abbreviated ID is matched with `git rev-parse --disambiguate`, and only the matches that are commits, not annotated tags, and are the Change's base or head or one of their ancestors (`git merge-base --is-ancestor`) count, so a commit elsewhere never changes the answer. A revision with no such commit is refused with the same message whether its commit is elsewhere or nowhere. Its `~N` and `^N` are applied only after that check, and can only reach ancestors. Git then runs with the resolved commit IDs. A resolution that takes longer than the timeout is reported as stopped, not as a missing commit. `log` walks from the Change's base and head, or the range given, never `--all` or other refs, and its format leaves out ref names.
- **Arguments.** No argument can start with `-`, and revisions can't hold whitespace, control characters or a range. Paths must be relative, normalised, and stay inside the repository; they go after `--`, and git reads them literally. `blame` always names a commit, so it never reads the worktree, and unknown arguments are refused. Every check runs before git does.
- **Fixed git options.** Every run starts with `--no-pager`, `--no-lazy-fetch`, `--literal-pathspecs`, `--attr-source` set to the empty tree and `-c` overrides for `core.pager`, `core.hooksPath`, `core.fsmonitor`, `core.commitGraph`, `core.attributesFile`, `color.ui`, `log.showSignature`, `log.decorate` and `blame.ignoreRevsFile`. Neither the working tree's `.gitattributes` nor an attributes file in the config shapes a result. The commands that make diffs add `--no-ext-diff`, `--no-textconv`, `--no-color` and `--text`. `GIT_OPTIONAL_LOCKS=0` keeps git from writing the index. `--no-lazy-fetch` and `GIT_NO_LAZY_FETCH=1` keep a partial clone from fetching the objects it lacks, which would reach the network and run its SSH command: git reports them missing instead. `GIT_NO_REPLACE_OBJECTS=1`, `GIT_GRAFT_FILE=/dev/null` and `core.commitGraph=false` keep replace refs, grafts and a commit-graph file from giving a commit other parents, which could lead outside the Change's history. Nothing passes `--output` or any other option that writes.
- **Git version.** The tools need git 2.44 or later, the first with `--no-lazy-fetch`: an older git ignores `GIT_NO_LAZY_FETCH` and would still fetch, and one older than 2.40 fails on `--attr-source`. The server runs `git version` when it starts, and keeps the answer only when git can run the tools: after a failed check, such as a slow first run or a git still to be installed or updated, the next tool call checks again. On an older git, or none, every tool call is refused with a message that names the version this machine has, and the rest of the Assistant works as before.
- **Caps.** Each result keeps at most 20,000 characters, as ADR 0026 caps the commits in a prompt, and git is killed once it prints more. A result that was cut off says so and how to narrow the request. Each git run has a ten-second timeout; a run past it is killed, and the Assistant is told.
- **Other people's text.** Each result opens by saying what it is and that its messages, authors, lines and diffs are other people's text to read as data, never instructions, then gives the output of git in a code fence that nothing inside it can close (ADRs 0017 and 0026). When git fails, what it said comes back fenced in the same way, as it can quote the repository.
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
- Bad, because the Assistant can't name a commit by branch or tag, only by its ID or as `base` or `head`.
- Bad, because a machine with git older than 2.44, such as one on Ubuntu 24.04's own git, gets no git tools until git is updated.
- Bad, because in a partial clone, a tool that needs a missing file's contents fails rather than fetching it.
- Bad, because a new git option that runs a program or reads config would need adding to the fixed options, as `log.showSignature` needed.
- Bad, because the server speaks a hand-written subset of MCP, which a future protocol version could outgrow.
