---
status: accepted
date: 2026-10-19
---

# Treat everything from a Change as data, and hold that line with controls that don't depend on the model

## Context and Problem Statement

The Assistant reads other people's text: code, file names, diffs, commit messages, a pull request's description and review Comments. Any of it can carry instructions aimed at the Assistant, which is prompt injection. The defences were spread over ADRs 0004, 0011, 0014, 0017, 0022, 0026 and 0030, and no one place said what Dear Reviewer defends against, what each defence covers and what it leaves open (issue #112). `docs/threat-model-assistant.md` models the path from a Change's text to the prompt, the Assistant, the screen and GitHub. What is the policy, and what did the review of that path find?

## Considered Options

- One written policy with a rule for every kind of text, tied to the controls that hold it, and fixes for the gaps the review found
- Rely on the model to resist injection, with a stronger system prompt
- Sandbox the `claude` process in the operating system

## Decision Outcome

Chosen option: one written policy, plus fixes. A system prompt can lower the chance that a model is steered, but nobody can check it, so no control can depend on it. An operating-system sandbox would be the strongest control, but it differs on macOS, Linux and Windows, and the Assistant's login and files live in the Reviewer's home folder. It stays an option for later.

The policy has five rules.

1. **Other people's text is data.** The code, file names, diffs, commit messages, authors, a pull request's title and description, and Comments are never instructions. Every prompt that carries such text puts it in a code fence that nothing in it can end (`fenced`), after a line that says it is other people's text. The role says the same, and tells the Assistant to say in one sentence when it finds text that tries to steer it, and to continue with the Reviewer's request. File names are fenced in lists, and shown in prose as a quoted string when they hold a control character.
2. **The Assistant reads the Change and nothing else.** `--allowedTools` lists the four git tools and no file tool. In `dontAsk` mode, Claude Code lets `Read`, `Grep` and `Glob` work in the working folder and the `--add-dir` folders (the two worktrees and the Change's Assistant folder) without a rule, and refuses every other path, including a symbolic link inside a worktree whose target is outside. A bare `Read` in `--allowedTools` is an allow rule for every file, which is what the code did before this ADR. A bare `Read` in the Reviewer's own `~/.claude/settings.json` does the same, and is common. `--setting-sources` is empty for that reason: no user, project or local settings file loads, and the Reviewer's `model` setting, `env`, `apiKeyHelper` and hooks don't apply to the Assistant.
3. **No credential reaches a process the Assistant controls.** `claude` gets an allow list of variables (ADR 0004). The git server gives git an allow list too (`PATH`, `HOME`, `USER`, `LOGNAME`, `TMPDIR`, `LANG`, `LC_*`), and no `GIT_*` variable but the fixed ones of ADR 0030.
4. **The Assistant's output is untrusted.** Findings, the Reading Order and file references are parsed strictly and kept only when they name files and lines in the Change (ADR 0017, ADR 0022). Replies and the summary render through the extension's Markdown renderer, which drops HTML, turns images into links, and opens only web links the extension sent (ADR 0011). A webview has no remote `img-src`. A Finding's hover escapes its message and runs two fixed commands.
5. **Only the Reviewer publishes, and reads what leaves.** Nothing reaches GitHub until the Reviewer saves a Comment and submits the Review (ADR 0007, ADR 0017). A Brief opens in the editor for the Reviewer to read before they copy it (ADR 0016), and its prompt tells the Assistant to take nothing from the code except what a Comment points at.

What the review found and this ADR fixes:

- **Reads were not limited to the Change.** On `claude` 2.1.304, with `--tools Read,Grep,Glob --allowedTools Read,Grep,Glob --permission-mode dontAsk --add-dir <worktree>`, the Assistant read a file outside the worktree directly, through a symbolic link inside the worktree, and with `Grep` and `Glob`. With the same flags and `--allowedTools mcp__git__log`, it read files inside the worktree and was refused the file outside, the links to it, `Grep` and `Glob` there, and `/etc/hostname`. A tool result too large for the context, which Claude Code saves in its own session folder, still reads. With a user settings file that holds `"permissions": {"allow": ["Read"]}`, `--setting-sources user` read the outside file again, and `--setting-sources ""` refused it, with the login still working.
- **The diff and the Brief's code had a fixed fence**, which a line of three backticks ended, and the Brief's code and the selection had no label. File lists were bare lines.
- **The git server copied its environment.**

The policy leaves some paths open, with the reasons in the threat model: a steered summary that the Reviewer does not check against the diff, a link in a reply that the Reviewer clicks and that carries text in its URL, and a Finding that the Reviewer converts into a Comment without reading, whose image link GitHub would render.

### Confirmation

- Unit tests in `extension/test/unit/prompts.test.ts` build each prompt with an injection payload in the description, a commit message, a diff, a file name and the Brief's code, and check that the payload sits only inside a fence, whatever backticks it holds. `claude.test.ts` checks that `allowedWithoutAsking` holds no file tool, and `gitServer.test.ts` checks the git environment.
- The integration test for the summary checks the flags of a real run: `--allowedTools` is the four git tools, with no `Read`, `Grep` or `Glob`.
- Re-run the read probe whenever Claude Code changes how it checks permissions. In an empty folder with `outside/secret.txt`, `work/head/ok.txt` and a link to the secret in `work/head`, start `claude -p` from a separate empty folder, with the flags above, `--allowedTools mcp__git__log` and `--setting-sources ""`, and ask it to read each; the secret and the link must be refused. Repeat with `CLAUDE_CONFIG_DIR` set to a folder whose `settings.json` allows `Read`.

### Consequences

- Good, because the worst result of a successful injection moves from reading any file the Reviewer's user can read to steering the Assistant's words, or a Brief that the Reviewer pastes unread, and the Reviewer reads the diff and the Brief and decides.
- Good, because the policy is in one place, and the controls each ADR added are tied to what they cover.
- Bad, because the protection is Claude Code's own rule for `dontAsk` mode, which a later release could change. The integration test sees the flags, not the effect, so the probe is a manual step.
- Bad, because the Assistant no longer follows the Reviewer's own Claude Code settings, such as `model`: it runs on Claude Code's default model. Passing `--model` would restore a choice, and would be a setting of Dear Reviewer's own.
- Bad, because a login that exists only in settings, an `apiKeyHelper` or a cloud provider in `env`, no longer reaches the Assistant, while `claude auth status`, which takes no `--setting-sources`, still reports it. Such a Reviewer sees a login that the Assistant can't use. A login by `claude /login` is not in settings, and works.
- Bad, because `--setting-sources ""` and the permission rule are verified on `claude` 2.1.304 only, on Linux. The extension checks no version of `claude`.
- Bad, because every prompt is longer by a few labeled lines.
- Bad, because the model can still be steered, and the Assistant's own reading of a Change is one the Reviewer must check.
