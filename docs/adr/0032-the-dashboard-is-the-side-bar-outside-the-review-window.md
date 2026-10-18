---
status: accepted
date: 2026-10-15
---

# The Dashboard is the Dear Reviewer side bar outside the review window

Amended by [ADR 0040](0040-one-active-change-in-the-review-window.md): the Dashboard lists the one Active Change under that heading, where In progress listed every open Change, and no window but the review window holds a Change.

## Context and Problem Statement

ADR 0025 hid the Inbox in the review window and put Home in its place: a page in the editor area that showed where the Reviewer stood across their Changes when no Change was in front there. That served a moment the Reviewer doesn't have. In the review window a Change is nearly always in front, and its overview already says where they stand on it. Meanwhile, in the Reviewer's own windows, where they work all day and choose what to review next, the Dear Reviewer side bar held three views and only one worked there. Change Files and Findings showed welcome text and buttons, Open Change and Ask for Findings, that only make sense with a Change in front, and in the Reviewer's own window there never is one: opening a Change hands it to the review window. Where should the Reviewer see where they stand, and start the next review (issue #38)?

## Considered Options

- The Dashboard: a webview in the side bar of the Reviewer's own windows, in place of its views there, combining the Inbox's lists with Home's facts and next step
- A Dashboard page in the editor area of the Reviewer's own windows, beside the side bar's views
- A native tree in the side bar with In progress and Waiting on you groups

## Decision Outcome

Chosen option: the Dashboard in the side bar, because it is what the Reviewer sees on clicking Dear Reviewer in the activity bar, and it holds only what works in their window. A page in the editor area would leave the three views beside it, two of them dead, and take the editor from the Reviewer's own work. A native tree can't hold a facts line or one filled button for the next step, and a Change in progress needs two actions on its row.

- **Where.** The side bar's one view in every window but the review window is the Dashboard (`dearReviewer.dashboard`, a webview view titled Dashboard). Clicking the Dear Reviewer icon shows it, as do **Dear Reviewer: Show Dashboard** and `Ctrl+Alt+R H`.
- **What.** Top to bottom: a facts line, the one filled button for what comes next under the Next Step Rule, In progress, the Change shown last first, Waiting on you, for the pull requests not open as a Change, so each shows once, Your pull requests, Reviewed by me and Local branches, then Open a commit range…. The lists come from the Inbox's own load and the overview's standing, so they never disagree with them.
- **The review window.** Its side bar holds Change Files and Findings for the Change in front, and no Dashboard. Home goes: nothing opens in the review window when its last Change closes.
- **Change Files and Findings** show only where a Change can be in front: in the review window, or in a window that holds a Change itself, as a window of more than one folder can. Their title-bar actions show only while a Change is open.
- **Across windows.** In progress lists the Changes open in any window, from the open-Changes file every window shares. Resume and Finish on a Change another window shows can't act from the Reviewer's window, so they write a request to `review-window-requests.json` in the extension's storage and bring the review window forward, opening it if it's closed. The review window watches that file, and reads it as it starts. It carries out each request for a Change it shows: Resume brings the Change to the front; Finish also starts Submit Review… or Write Brief…. A request for a Change whose folders are still on their way waits for them, one for a Change no longer open is dropped, and any request older than two minutes is dropped rather than carried out late. A newer request for a Change replaces an older one.
- **Pending Comments** for a Change in progress come from where its Review is kept, GitHub or the extension's storage, when the window doesn't show the Change, since only a window that shows it loads its comment threads.
- **Opening a commit range** picks the base and head from the repository's branches, remote branches and tags, main first for the base and the checked-out branch first for the head, with any other commit by name. A range with no commits, or one git can't find, is said before any worktree is made.
- **The Inbox** stays as the data the Dashboard lists, in a tree's shape that the tests read, but is no longer a view.

This supersedes ADR 0025.

### Consequences

- Good, because clicking Dear Reviewer shows only what works in that window, and the review in progress is visible from the Reviewer's own window.
- Good, because each list shows in one place, so the Dashboard and the Inbox can't disagree.
- Bad, because the Dashboard is a webview, without a native tree's type-to-find and expand and collapse; it moves between a list's rows with the arrow keys instead.
- Bad, because Resume and Finish from the Reviewer's window depend on a file the review window watches, so they take effect only once that window is running and has read it.
- Bad, because the review window has no list of what's waiting: the next review starts from the Reviewer's own window.
