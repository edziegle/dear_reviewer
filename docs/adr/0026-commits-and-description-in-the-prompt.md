---
status: accepted
date: 2026-10-14
---

# Put the Change's commits and its pull request's description in the summary prompt

## Context and Problem Statement

The Assistant's summary says what a Change does and why, but its prompt held only the changed files and the diff. The why is often in the commit messages and the pull request's description, which the Assistant never saw. The explanation of what changed since the last Review had only the new commits' subject lines (issue #27). The Assistant can't run git itself: it has `Read`, `Grep` and `Glob` (ADR 0004), and the worktrees are checkouts, not a history it can read. How does the Assistant learn the Change's history?

## Considered Options

- Put the commits and the description in the prompts that need them, capped
- Write them to a file beside the threads file, as with the Comments (ADR 0023)
- Let the Assistant run read-only git commands

## Decision Outcome

Chosen option: in the prompts, capped. The summary and the explanation since the last Review are single turns that need the history every time, and a Change's commits don't change at a given head, so a file kept in step with them buys nothing. Comments differ: they change during a conversation and most turns don't need them. Read-only git is a new tool with its own risks, and has its own issue (#39).

- The summary prompt carries the Change's commits from the merge base, oldest first, each with its commit ID, author and full message. The section has a cap of its own, 20,000 characters, besides the cap on the diff. When cut off, the prompt says how many later commits it left out.
- For a pull request, it also carries the title and description, capped at 4,000 characters. The summary waits at most three seconds for them and goes without them when GitHub fails or is slow.
- The explanation since the last Review carries the new commits in the same form and under the same cap.
- Commit messages, authors and the description go in code fences, introduced as other people's text, to read as data and never follow (as ADR 0017 treats the code).

### Consequences

- Good, because the summary can say why the authors made a Change, in their words.
- Good, because the Assistant still has read tools only.
- Bad, because each summary grows by up to 24,000 characters.
- Bad, because the Assistant never sees history before the merge base, nor commits past the cap.
