---
status: accepted
date: 2026-10-14
---

# Finish a Review from its Change, end a local Review when its Brief is copied, and let a pending Review be discarded

## Context and Problem Statement

A design critique of the review flow (2026-10-14) found that finishing a Review was the hardest part to find. Submit Review, Write Brief, Close Change, Show Timeline and Show Assistant could only be run from the command palette, and each one first asked which Change to act on, even when only one was open or the Reviewer was looking at its diff. Submit Review published without saying how many Comments it would publish, and a pending Review couldn't be dropped. Writing a Brief ended a local Change's Review straight away, before the Reviewer had read the Brief: if the Brief was poor, its Comments were already out of the gutter. Where does a Reviewer finish a Review, which Change do commands act on, and when does a local Review end?

## Considered Options

- Put the finishing actions on the Change in Change Files and on the timeline, act on the Change the Reviewer is looking at, end a local Review when its Brief is copied, and offer Discard Pending Review
- Keep the commands in the palette, and only stop asking which Change when one is open
- A separate "finish" webview that shows the pending Comments and the verdict together

## Decision Outcome

Chosen option: actions on the Change and the timeline, because they put Submit and Write Brief where the Reviewer already is, use native tree menus (ADR 0012), and match the JetBrains review flow PRODUCT.md takes as its reference. A separate webview would copy the Comments that already show as native threads in the editor's gutter.

- The Change's row in Change Files offers Submit Review for a pull request or Write Brief for a local Change, then Show Timeline and Show Assistant, as inline buttons. Its context menu adds Discard Pending Review, Show Changes Since My Last Review when there are new commits, Ask for Findings, the viewed actions and Close Change. The row says whether there are new commits since the Reviewer's last Review.
- The timeline's header has a Submit Review button, which runs the same command for its Change.
- A command run without a Change acts on the Change of the panel or editor the Reviewer is looking at, or else on the only Change in this window that fits, such as the only pull request for Submit Review. It asks only when more than one fits.
- Submit Review names the pull request and how many pending Comments it publishes, both when it asks for a verdict and when it confirms, and shows progress while GitHub takes the Review.
- Discard Pending Review deletes a pull request's pending review on GitHub with `deletePullRequestReview`, or a local Change's kept Comments, after a confirmation that says how many Comments go. Nothing is published.
- Write Brief no longer ends the Review. It writes the Brief, opens it, and records which threads it covered at which head. Copying that Brief ends the Review: those threads leave the storage and the gutter, and its head becomes the last reviewed commit. Copying an older Brief only copies it. This amends ADR 0016.
- Keybindings under the `Ctrl+Alt+R` chord move to the next or previous unviewed file, mark the file shown viewed and open the next, step through Findings, show the Assistant, ask for Findings, and finish the Review. They work while a Change is open in the window.

### Consequences

- Good, because the most important step of a Review is one click from the Change, and says what it will publish before it publishes.
- Good, because a Reviewer reads and edits a Brief before their Comments leave the gutter, and can write it again if it's poor.
- Good, because a pending Review that went the wrong way can be dropped without going to github.com.
- Bad, because acting on the Change the Reviewer is looking at can surprise someone who has more than one open and expected to be asked. The verdict picker names the pull request, which is the check.
- Bad, because a Brief that is never copied leaves its Review open, so the Inbox doesn't mark the branch's later commits as new since a Review.
- Bad, because the `Ctrl+Alt+R` chord might clash with a Reviewer's own keybindings; they can rebind it.
