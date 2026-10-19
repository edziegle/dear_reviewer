---
status: accepted
date: 2026-10-18
---

# Hold one Active Change, in the review window

## Context and Problem Statement

The review window showed one Change at a time but held every Change opened in it until each was closed, and nothing in the window said so. One Reviewer's held six while they believed one was open. Closing the review window doesn't close its Changes, so the next review window reopened them all, hidden behind the new one.

Hidden Changes did harm. A hidden release pull request, force-pushed after a merge, took the front in place of the Change the Reviewer was reading (#101). Review threads of hidden Changes loaded in the background, and their failures raised toasts naming pull requests the Reviewer didn't know were open (#67). Each hidden Change kept two worktrees, workspace folders, a GitHub check on every focus (ADR 0036) and, once started, a running Assistant. ADR 0002 gave reviewing more than one Change at once as the reason for one shared review window, and in practice the Reviewer reviews one. How many Changes should the review window hold (issue #102)?

## Considered Options

- Keep holding every Change, and list them in the review window (#68)
- Hold one Change, the Active Change, in the review window
- Hold one Change in each of many review windows

## Decision Outcome

Chosen option: hold one Change, the Active Change, because a Change the Reviewer can't see shouldn't cost them anything, and listing hidden Changes (#68) would only make a state they don't want easier to see.

- **One Active Change.** The review window holds exactly one Change. Opening another, from the Dashboard, Open Commit Range… or anywhere else, stops reviewing the Active Change and makes the new one active. The shared list of open Changes holds at most one, and opening a Change replaces the old one in the same locked write, so no window sees two, or none, on the way.
- **The switch is immediate, and keeps what the Reviewer made.** Stopping a Change keeps its pending Comments (the pending review on GitHub, or the local Review), its Assistant conversation and a pull request's viewed files on GitHub. A local Change's viewed files are now kept by its branch, not by its Change id, so they survive the switch. An Assistant reply in progress stops, with a note in its conversation saying so. Opening the first Change again picks it up again.
- **A Comment being written asks first**: "Discard the Comment you're writing on <name>?" Discard opens the new Change. Cancel keeps the Active Change and opens nothing. Only the window that shows the Active Change can see its draft, so a Change opened from another window replaces the Active Change without this question.
- **Closing the review window keeps the Active Change.** It stays active while the window is closed. The Dashboard shows it, and Resume reopens the review window on it.
- **Only the review window holds Changes**, as ADR 0002 says. A Change opened from any other window, including one of the Reviewer's saved multi-root workspaces, opens in the review window and adds no folder to that workspace. Adding folders to the current window ends, and the Assistant's view shows in the review window only.
- **A newer head replaces the Active Change**, as it did (ADR 0020, ADR 0036).
- **On upgrade**, a review window holding more than one Change keeps the one shown last and stops reviewing the rest.
- **The Dashboard** shows the one Active Change under the heading Active Change, where In progress listed every open Change.

This amends ADR 0002, whose reason for one shared review window was reviewing more than one Change at once, ADR 0020, ADR 0032, ADR 0036 and ADR 0038.

### Consequences

- Good, because nothing is open that the Reviewer can't see: no hidden Change takes the front, raises toasts, checks GitHub on focus or keeps an Assistant running.
- Good, because the Change in front stops being a question: Change Files, Findings, the Assistant and the review keys follow the one Active Change.
- Bad, because the Reviewer who went back and forth between two Changes now stops one to read the other. Its Comments, conversation and viewed files wait for it, but its editors and overview do not.
- Bad, because a draft Comment in the review window is only protected when the Change is replaced from that window.

### Possible future direction

More than one review window, each with its own Active Change, would give back reviewing two Changes at once without hiding either. Not decided: ADR 0002 rejected a window for each Change for juggling windows and indexing folders twice, and the Reviewer hasn't asked for it.
