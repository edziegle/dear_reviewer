---
status: accepted
date: 2026-10-13
---

# End a Change when GitHub says its pull request was merged or closed, or when its worktrees are gone

## Context and Problem Statement

A Change's worktrees live until the Change is merged or closed, or until the Reviewer closes it (spec #1, #15). Until now only Close Change removed them, so each merged pull request left two worktrees in the extension's storage, two entries in `git worktree list` of the Reviewer's clone, and, under ADR 0009, a saved Assistant conversation that nothing ever removed. A Reviewer can also delete worktrees outside Dear Reviewer, such as by clearing its storage to reclaim space. The window then holds folders that point at nothing, and git keeps records of worktrees that no longer exist. When does Dear Reviewer learn that a pull request is over, what does it remove, and what happens to a Change whose worktrees were deleted?

## Considered Options

- Check each pull request's state on GitHub when the window starts, when the Inbox refreshes and when the Reviewer signs in, and treat a Change with deleted worktrees as closed
- Check on a timer
- Leave it to the Reviewer: offer to close merged pull requests' Changes, and recreate deleted worktrees when the window starts

## Decision Outcome

Chosen option: check on GitHub when the window starts, when the Inbox refreshes and when the Reviewer signs in, and treat a Change with deleted worktrees as closed. These are the moments the Reviewer expects the window to catch up with GitHub, and they cost no requests while the window sits idle. A timer would query GitHub all day for windows nobody is looking at. Asking the Reviewer about each merged pull request adds a chore to every merge, and recreating deleted worktrees at startup would undo a Reviewer who deleted them on purpose.

- Dear Reviewer asks GitHub for the state of each pull request that is open as a Change or has a saved conversation, one request per pull request. A pull request GitHub can't answer for, such as when the Reviewer is signed out, doesn't exist, or the request fails, counts as open.
- When a pull request is merged or closed, its Change closes as Close Change closes it: its folders leave the window, its worktrees are deleted, git's records of them are pruned, and its Assistant and timeline panels close. Its Assistant conversation is forgotten too, including one whose Change the Reviewer had already closed. This finishes what ADR 0009 left to this work. A closed pull request that is reopened on GitHub starts a new conversation.
- A Change whose base or head worktree, or whose repository, was deleted outside Dear Reviewer is closed the same way at those moments. Git's records of its worktrees are pruned, and the other worktree, if any, is deleted. Opening the Change again recreates both worktrees, as before.
- Each window also removes any of its folders in Dear Reviewer's folder of Changes that no open Change names, such as those of a Change another window closed, or all of them after the Reviewer deleted the extension's storage.
- Removing folders never touches the first folder of a window (ADR 0002).
- A local Change is never closed on its own: Dear Reviewer has no way to know that a branch or range is finished. The Reviewer closes it.
- Opening, closing and this tidying run one after another in a window, so tidying can't delete worktrees that an opening Change is still creating there.

### Consequences

- Good, because merged and closed pull requests stop using disk space and stop cluttering the clone's `git worktree list`, without the Reviewer doing anything.
- Good, because a window whose Change worktrees were deleted recovers at its next start or Inbox refresh, instead of keeping folders that point at nothing.
- Good, because conversations of finished pull requests no longer pile up in the extension's storage.
- Bad, because a merged pull request's Change stays open until the next start, Inbox refresh or sign-in.
- Bad, because each check sends one request per pull request with a Change or a saved conversation.
- Bad, because a window can delete the worktrees of a Change that is open in another window. That window's folders leave it at its own next check, and until then they point at nothing.
- Bad, because the Reviewer loses any files they changed in a merged pull request's worktrees, and the Assistant conversation can't be brought back.
- Bad, because after the extension's storage is deleted, git's records of the deleted worktrees stay in the clone until the next Change opened from it prunes them, since nothing records which clone they belonged to.
- Bad, because a local Change stays open until the Reviewer closes it, and its conversation stays in the extension's storage after that.
