---
status: accepted
date: 2026-10-14
---

# In the review window, Home takes the Inbox's place

## Context and Problem Statement

Every window shows the Dear Reviewer side bar with all three views: Inbox, Change Files and Findings. ADR 0010 counted it as good that the review window's Inbox works with nothing configured, and ADR 0020 has a Change open with Change Files in the side bar, saying nothing of the Inbox. In use, the Inbox above Change Files took space from the Change under review, turned the review window back into a queue, and showed the same list as the Reviewer's own window. The Reviewer still used it to open the next pull request from the review window, so it can't just go. Home (issue #38) was already planned for the review window's editor area, with a Waiting on you section listing what the Inbox lists. Where should the review window offer the next Change?

## Considered Options

- Hide the Inbox in the review window, and let Home's Waiting on you open the next Change
- Hide the Inbox in the review window only while a Change is open
- Keep the Inbox, collapsed by default

## Decision Outcome

Chosen option: the review window's side bar has no Inbox, and Home's Waiting on you does its job there. The side bar is for the Change in front: Change Files and Findings. The editor area is for choosing the next one: Home, which opens when no Change is in front, when the last Change closes, and from Show Home. The Reviewer's other windows keep the Inbox unchanged.

The Inbox leaves the review window in the same change that adds Home's In progress and Waiting on you, so the review window never lacks a way to start a review.

Hiding it only while a Change is open would have done as a stopgap but would change twice. The editor can't collapse one view in one window only, and a manifest default would collapse the Inbox everywhere.

This amends ADR 0010, whose review window Inbox becomes Home's Waiting on you, and ADR 0020, whose review window side bar holds Change Files and Findings alone.

### Consequences

- Good, because the side bar's height goes to the Change under review.
- Good, because each list shows in one place per window: the Inbox in the Reviewer's own window, Waiting on you in the review window.
- Bad, because Waiting on you must show the same facts as the Inbox from the same data, or the two windows disagree.
- Bad, because a Reviewer who wants the queue while a Change is open must open Home, one command away instead of always on screen.
