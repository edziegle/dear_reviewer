---
status: accepted
date: 2026-10-13
---

# Keep each Change's Assistant conversation by pull request or branch, and resume it with `claude --resume`

Amended by [ADR 0013](0013-end-changes-that-are-over.md): the conversation of a pull request that GitHub says was merged or closed is forgotten, whether or not its Change is still open.

Amended by [ADR 0015](0015-what-changed-since-the-last-review.md): when the Assistant starts or moves to a head with new commits since the Reviewer's last Review, it explains what changed, and the saved conversation keeps which commits it explained.

Amended by [ADR 0016](0016-local-comments-and-briefs.md): a local Change's Comments and last Brief are kept under its conversation name too, and the Assistant writes the Brief in the Change's conversation.

## Context and Problem Statement

The glossary says a Change's conversation with the Assistant lasts for the life of the Change: across Reviews and window reloads, until the Change is merged or closed. ADR 0004 runs one `claude -p` process per Change, so the conversation ends when the window reloads. Dear Reviewer's Change id hashes the repository, merge base and head, so a new commit gives a new id, new worktrees and, for a pull request, a new open Change. What should the saved conversation be keyed on, what happens to it when a new head arrives, and where does `claude` run so that its session can be resumed?

## Considered Options

- Key the conversation on the Change id
- Key the conversation on what the Change is across commits: the pull request, or else the local branch, or else the commit range
- Replay the transcript into a new session after each reload, instead of resuming

## Decision Outcome

Chosen option: key the conversation on what the Change is across commits, because that is the Change the glossary means, and it keeps the conversation when new commits arrive.

- Each Change gets a conversation name when it opens: `pull request owner/name#number` for a pull request, `branch <name> in <repository>` when the head names a local branch (`HEAD` names the checked-out branch), and `range <merge base>..<head> in <repository>` otherwise. The name is kept with the open Change, so later commands that name the Change by its commits find the same conversation.
- The extension's storage keeps each conversation by name: the Claude session id, the head commit it last talked about, and the messages the panel shows. Dear Reviewer saves it after each turn.
- Claude Code keeps a session under the folder it ran in and resumes it only from there, so `claude` runs in a folder of the conversation's own in the extension's storage, not in the head worktree, and both worktrees are given with `--add-dir`. This changes ADR 0004's working directory. The system prompt gives the worktrees' absolute paths.
- When the panel opens with a saved conversation, it shows the saved messages and doesn't ask for a new summary. The Reviewer's next message starts `claude` with `--resume <session id>`.
- When a new head arrives, by reopening the Change at a new commit or by opening the new head while the old one is still open, the Assistant carries the same conversation on. Its panel moves to the newer Change, the panel shows a note with the old and new heads, and the next message restarts `claude` with `--resume` and the new worktrees. That message tells the Assistant that the head moved and where the new worktrees are. Explaining what changed since the last Review is left to the since-last-Review feature.
- If Claude Code can't resume the session, the Assistant says so in the panel and starts a new session with the same message.
- Closing a Change removes its worktrees but keeps its conversation, because the Reviewer might reopen it, for example at a newer head. Forgetting conversations of merged or closed pull requests is left to the lifecycle work that removes their worktrees.

### Consequences

- Good, because a pull request or branch keeps one conversation through new commits, rewritten history, window reloads and reopening.
- Good, because the earlier turns come back from Claude Code's own session, so nothing has to replay them into a new context.
- Bad, because `claude` no longer runs in the head worktree: the Assistant has to use absolute paths, and relative paths in its answers mean nothing.
- Bad, because saved conversations stay in the extension's storage until the lifecycle work removes them, and a local range or branch that is never merged keeps its conversation.
- Bad, because two windows showing different heads of the same pull request would each resume the same session.
- Bad, because the pull request key leaves out the GitHub host, so the same pull request name and number on GitHub Enterprise and github.com would share a conversation.
- Bad, because the session file layout and `--resume` behaviour belong to Claude Code and could change.
