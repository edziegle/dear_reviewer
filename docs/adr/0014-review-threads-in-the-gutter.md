---
status: accepted
date: 2026-10-13
---

# Show a pull request's review threads on its diff, reply in the pending review, and resolve over GraphQL

Amended by [ADR 0024](0024-reply-to-your-own-pending-threads.md): the Reviewer can add follow-up Comments to their own threads in the pending review or a local Review.

## Context and Problem Statement

ADR 0007 shows only the threads the Reviewer started in their pending review, so their teammates' threads never reach the diff, and the Reviewer's own threads leave the gutter once they submit the Review. The spec asks for existing review threads at the right lines (#26), for replies to them (#32), and for resolving them and marking them unresolved again (#27). GitHub keeps each thread's place as a line or range on one side of the diff, and when a later commit removes those lines it marks the thread outdated and keeps only the line it was written on. Which threads does Dear Reviewer show, where does it show outdated ones, where does a reply go, and how are threads resolved?

## Considered Options

- Every thread the Reviewer can see, as native comment threads from Dear Reviewer's one comment controller; outdated threads at the lines they were written on; replies into the pending review when one is open, or else published at once; resolving with `resolveReviewThread` and `unresolveReviewThread`
- The same, but each reply starts a pending review when none is open
- Leave outdated threads out, as github.com's Files tab does

## Decision Outcome

Chosen option: every thread, outdated ones included, with replies into the pending review only when one is open. Replying to a teammate is usually one answer that they're waiting for, and starting a pending review for it would hide the answer until the Reviewer remembers to submit. When a Review is under way, the reply waits with its other Comments and reaches the author in the same notification (ADR 0007). Dropping outdated threads would hide discussions that are still open.

- One GraphQL query reads the Reviewer's pending review and every review thread the Reviewer can see (`reviewThreads`, 100 to a page), with each thread's side, lines, original lines, `isOutdated`, `isResolved` and its first 100 Comments, with their authors. It replaces ADR 0007's query of the pending review, and runs at the same moments, and again after the Reviewer submits a Review.
- Threads on a whole file, which have no line, are left out.
- A thread started in the pending review stays as ADR 0007 has it: the Reviewer edits or deletes its Comments and doesn't reply to it. Every other thread takes replies, and offers to resolve it or to mark it unresolved again.
- A Comment in the pending review, including the Reviewer's reply to another person's thread, can be edited and deleted. Published Comments can't be changed from Dear Reviewer.
- Published Comments show GitHub's Markdown through VSCodium's own Markdown renderer, with trust and HTML turned off, so no link in them runs a command. Each shows its author's avatar, from the Inbox's avatar cache, and when it was written.
- A thread is outdated when GitHub says so or gives it no line. It shows on its own side at the lines it was written on, as far as the file reaches, with the label "Outdated". When its own side no longer has the file, such as a head-side thread on a file the pull request later deleted, it shows on the other side's copy.
- Resolved and outdated threads start collapsed, as on github.com. Others start expanded.
- A reply goes into the pending review if Dear Reviewer knows of one or GitHub reports one, through `addPullRequestReviewThreadReply` with the review's id. With no pending review, the same mutation without an id publishes the reply at once.
- Submitting a Review reloads the threads, so its Comments stay on the diff as published ones. This ends ADR 0007's consequence that published threads leave the gutter.
- Threads load once per Change shown in the window, and after a submit. Threads other people add or resolve later appear when the Change is shown again, such as after a reload.

### Consequences

- Good, because the Reviewer sees the whole discussion on the diff, beside the code it is about, and can answer and close it there.
- Good, because a reply during a Review reaches the author with the rest of that Review, and a reply outside a Review isn't held back.
- Good, because outdated threads stay visible, so an open discussion isn't lost when the code under it moves.
- Bad, because an outdated thread's line is where it was written, in an older version of the file, so it can point at unrelated code in the head.
- Bad, because the gutter doesn't update when teammates comment or resolve while the Change is open.
- Bad, because every published thread offers to resolve it or mark it unresolved, even where GitHub won't let the Reviewer change it. GitHub then refuses, and Dear Reviewer shows its error.
- Bad, because the threads' lines come from GitHub's latest head. A Change opened at an older head shows them where the latest head has them.
- Bad, because a thread with more than 100 Comments shows only its first 100.
