---
status: accepted
date: 2026-10-14
---

# Let the Reviewer add follow-up Comments to their own pending and local threads

## Context and Problem Statement

ADR 0014 kept ADR 0007's rule for a thread the Reviewer started in their pending review: they edit or delete its Comments and don't reply to it. ADR 0016 gave a local Change's threads the same rule. In practice the Reviewer often wants to add to what they wrote, such as a second thought, a "same applies below", or a code suggestion after the explanation, and folding it into the first Comment is clumsy. On github.com they can reply to their own pending comment, and the reply joins the same pending review (issue #31). Should their own unpublished threads take follow-up Comments?

## Decision Outcome

Chosen: yes. A thread in the pending review takes replies, which join that review through `addPullRequestReviewThreadReply` with the pending review's id, so they still reach the author in one notification with the rest of the Review (ADR 0007). A local Change's thread takes replies that join it in the local Review, and its Brief shows the thread's Comments together, in order. Each Comment stays editable and deletable on its own. Deleting a thread's first Comment while replies remain does what GitHub does with a pending thread, and a local thread does the same, so the two kinds of Change agree. The reply button reads Add Review Comment, saying the Comment waits for the Review. This amends ADR 0014 and ADR 0016.
