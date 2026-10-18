---
status: accepted
date: 2026-10-14
---

# Open a Change quietly, with its overview alone, and let a newer head replace the older one

Amended by [ADR 0025](0025-home-replaces-the-inbox-in-the-review-window.md): the review window's side bar holds Change Files and Findings, and no Inbox.

Amended by [ADR 0038](0038-the-assistant-in-the-secondary-side-bar.md): showing a Change leaves the Assistant's view as it is, open or closed, and the view moves to the shown Change's conversation.

Amended by issue #25: an added file opens from the head worktree, and a deleted file from the base worktree, in a plain editor in the column beside the overview, not as a diff with one empty side. Modified files still open as diffs.

Amended by [ADR 0040](0040-one-active-change-in-the-review-window.md): opening a Change stops reviewing the Active Change, so no Change waits behind the one shown. A newer head still replaces the older one.

## Context and Problem Statement

ADR 0019 opened each Change with its multi-file diff and its overview beside it. In use, the review window, one saved workspace that every review reuses (ADR 0002), brought back what the last session left: the earlier heads of the same pull request, each with its own diff in its own column, the overviews of every open Change after a reload, a terminal in a base worktree, and the Explorer full of the repository's files. Opening a pull request gave four narrow columns, code wrapped one word a line, the overview squeezed to the narrowest of them, and an empty terminal under it all (critique of 2026-10-14). The Reviewer couldn't tell which diff was the pull request they had opened. What should the review window look like when a Change opens, and what happens to a pull request's or branch's older head?

## Considered Options

- Open the overview alone, full width, and reset the window to that each time a Change opens; a newer head replaces the older Change
- Open the overview in front with the multi-file diff as a tab behind it
- Keep both heads open, with tabs named by pull request and head

## Decision Outcome

Chosen option: the overview alone, because a Reviewer needs their bearings before they read, and anything else on screen competes with that. The diff is one click away, and it opens when the Reviewer chooses to start.

- Opening a Change, and a reload of the review window, shows that Change the way a review starts: its overview alone in the main column, with the focus, and Change Files in the side bar. The bottom panel closes, as do the editor tabs of other Changes' files and diffs, including those a past session left, and other Changes' overviews and Assistant chats. Change Files and Show Overview bring them back. After a reload, only the Change opened last comes back this way.
- No diff opens with the Change. The diff of a file opens from Change Files, Next unviewed file, or the overview's Start at line, in the column beside the overview, which stays where it is. Open All Changes and the Assistant's `path:line` links open there too. Moving the overview instead turned out to be fragile: VS Code renumbers its columns, and a file opening in preview could replace the moved panel. Diff tabs are named after the Change, such as `acme/api #39`, not its commits.
- The overview's reading column is centred and capped, so it reads well in a full-width column. The Assistant's take shows at most three sentences, with Show all for the rest, and its first reference to a changed file as its own Start at line, which wraps rather than running off a narrow column.
- When a newer head of a pull request or branch opens, the older head's Change closes: its worktrees, folders, overview and Assistant chat. Its conversation carries on at the new head (ADR 0009), and what changed since the Reviewer's last Review shows in the overview (ADR 0015). A range of commits that isn't a branch has no newer head. This amends ADR 0013.
- The review window's workspace file turns off restored terminal sessions and hides the terminal on startup.
- This amends ADR 0019, whose overview opened beside the diff.

### Consequences

- Good, because a Reviewer opening a Change sees one thing: what it is, how big, where they stand and where to start.
- Good, because nobody reviews a head that a newer one has replaced.
- Bad, because a Reviewer who wanted two heads of one pull request side by side can't keep both open; Show Changes Since My Last Review covers the usual reason for wanting it.
- Bad, because opening a Change closes editors the Reviewer might have arranged; files of their own folders, outside Dear Reviewer's storage, are left alone.
- Bad, because whether VS Code honours the terminal settings at workspace scope depends on its version; closing the bottom panel on open works either way.
