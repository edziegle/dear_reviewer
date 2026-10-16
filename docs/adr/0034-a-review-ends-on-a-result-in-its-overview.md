---
status: accepted
date: 2026-10-16
---

# End every Review on a result in its overview, with Close Change as the next step

Amends [ADR 0033](0033-end-a-review-in-its-overview.md), [ADR 0018](0018-finish-a-review-from-the-change.md) and [ADR 0016](0016-local-comments-and-briefs.md).

## Context and Problem Statement

A third design critique (2026-10-16) found that the end of a Review is the quietest thing on the page. After a pull request's Review is submitted, its verdict is one muted line, and the Assistant's take, Start at and the highlighting prompt still read as if the Review had just begun. Close Change, the real next step, is a bare link, and no button is filled. A local Change ends worse: Write Brief shows a progress toast, a Markdown file, a toast that says to read and copy it, and a third toast once it is copied, so completion is a clipboard side effect. The offer made after the last file is viewed is also a toast, against the rule that Dear Reviewer shows no toast for what the Reviewer is waiting on. How should both kinds of Review end?

## Considered Options

- A result block in the overview for both kinds of Change, with the Brief still an editable file in the editor
- A result block for pull requests only, leaving Write Brief's toasts
- Write Brief as an in-overview step, as Submit is, with Copy Brief as its filled button

## Decision Outcome

Chosen option: a result block for both, because the Review then ends in one place and one way, on the page where it began, and the Brief stays a file the Reviewer reads and edits in the editor, which a webview can't offer (ADR 0012). A step for Write Brief would rebuild a Markdown editor into the overview.

- **The result block.** Under the header, in place of the muted standing line, a block says what happened in the body size and `foreground`, with a mark: `✓ You approved at 14:32 · 3 Comments published` for a pull request, `✓ You copied a Brief of 3 Comments at 14:32` for a local Change. Below it are its buttons. Exactly one is filled, under the Next Step Rule.
- **Pull request.** View on GitHub, secondary, and Close Change, filled.
- **Local Change, while the Brief is written.** The block reads `A Brief of 3 Comments is open in the editor. Read and edit it, then copy it for your agent.` Copy Brief is filled and Show Brief is secondary. Copying it, here or from the editor's title bar, ends the Review.
- **Local Change, once the Brief is copied.** The block says so, with Close Change filled and Show Brief secondary.
- **Nothing to brief.** A local Change with every file viewed and no Comments has no Brief to write, since the Assistant found nothing to change either. Its block says `Nothing to brief. You found nothing to change.` with Close Change filled, and Write Brief… is offered only once a Comment exists. The Dashboard's next step is Close for such a Change.
- **Writing.** While the Assistant writes the Brief, the overview shows its working line and progress bar, and a failure says why in the block, with Write Brief… to try again. The progress and result toasts are gone.
- **What steps back.** While the result block shows, Start at, Next unviewed file and the highlighting prompt hide, and the header's finishing button hides, since there is nothing left to finish. The facts line and checks stay as reference, and the Assistant's take and Reading Order fold behind one link, so the page no longer reads as the start of a Review. A 2px rule in the result's state color marks the block, which is the one rule in the overview that isn't the Assistant's. New commits since the Review clear the block, and the Review begins again.
- **After the last file.** Stepping past the last unviewed file no longer shows a toast. It brings the overview forward, with the focus on the filled Submit Review… or Write Brief… button, which is the next step.
- **Discard.** The Submit step and the Brief's block each offer Discard pending Comments… as a text link, so it is reachable from the page that lists what it would delete.

### Consequences

- Good, because both kinds of Review end on a clear result, with the next step filled.
- Good, because a Brief no longer ends in toasts and a clipboard side effect, and Show Brief reopens it.
- Good, because the Reviewer finishes the last file at the filled button, not in a notification.
- Bad, because the overview has two more states to keep in step with the Brief's file and the Review's storage.
- Bad, because a Brief copied outside the overview, from the editor's title bar, must reach the overview through the same record, so the Review's end is read from storage, not from a click.
