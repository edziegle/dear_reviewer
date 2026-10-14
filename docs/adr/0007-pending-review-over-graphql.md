---
status: accepted
date: 2026-10-14
---

# Keep a pull request Review's Comments in GitHub's pending review, over GraphQL

Amended by [ADR 0014](0014-review-threads-in-the-gutter.md): the gutter shows every review thread the Reviewer can see, not only those in their pending review, and a submitted Review's threads stay in it as published threads.

Amended by [ADR 0015](0015-what-changed-since-the-last-review.md): a pending review that Dear Reviewer starts covers the Change's head, which it passes as `commitOID`.

## Context and Problem Statement

The Reviewer writes Comments on lines and ranges of either side of a pull request's diff. The spec asks for them to reach the author in a single notification when the Review is submitted, and to survive reloads, both locally and on GitHub. Where do Comments live before the Review is submitted, and which GitHub API manages them?

## Considered Options

- GitHub's pending review, managed one Comment at a time with the GraphQL mutations `addPullRequestReview`, `addPullRequestReviewThread`, `updatePullRequestReviewComment`, `deletePullRequestReviewComment` and `submitPullRequestReview`
- GitHub's pending review through REST (`POST /pulls/{n}/reviews` without an `event`, then `POST /pulls/{n}/reviews/{id}/events`)
- Draft Comments kept in the extension's storage, posted together as one review when the Reviewer submits

## Decision Outcome

Chosen option: the pending review over GraphQL, because only this option saves each Comment to GitHub as soon as the Reviewer writes it. REST can only create a pending review with all its Comments in one request; it has no call to add a Comment to an existing pending review. Local drafts would be lost to the other machine and invisible on github.com. JetBrains uses the same GraphQL mutations (`docs/research/pycharm-github-pr-review.md`).

- The first Comment starts the pending review (`addPullRequestReview` with no `event`); later Comments go into it. GitHub allows one pending review per person and pull request, so a pending review started on github.com is reused.
- A Comment on the base worktree's file is `side: LEFT`, and one on the head worktree's file is `side: RIGHT`. A one-line Comment sends `line`; a range also sends `startLine`, with `startSide` equal to `side`. Lines are counted from 1.
- The gutter only offers Comments on the lines of each side that the diff shows, with three lines of context, because GitHub rejects Comments on other lines. Dear Reviewer works these out with `git diff -U3 --no-renames` between the Change's merge base and head.
- When a pull request Change is shown, and again after sign-in or a change of API URL if that failed, Dear Reviewer reads the viewer's pending review (`reviews(states: [PENDING])`) and the threads whose first Comment belongs to it (`reviewThreads`), and shows them as comment threads.
- Submitting sends the verdict (`APPROVE`, `REQUEST_CHANGES` or `COMMENT`) and the summary with `submitPullRequestReview`. With no pending review, it starts an empty one and submits that. Submitting ends the Review: its threads leave the gutter, and the next Comment starts a new pending review.
- Closing a Change leaves its pending review on GitHub, as it leaves viewed state.

### Consequences

- Good, because a half-finished Review is on GitHub, so it survives reloads and follows the Reviewer to their other machine and to github.com.
- Good, because the author still gets one notification, when the Review is submitted.
- Bad, because every Comment, edit and deletion is a request to GitHub, and none of them works offline.
- Bad, because a renamed file is a deletion and an addition to `git diff --no-renames` but a rename on GitHub, so a Comment on the old path of a renamed file is rejected.
- Bad, because published threads leave the gutter on submit until existing review threads are shown (issue #8).
