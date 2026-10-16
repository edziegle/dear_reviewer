---
status: accepted
date: 2026-10-16
---

# End a pull request's Review in its overview, listing the Comments it publishes

Amends [ADR 0018](0018-finish-a-review-from-the-change.md).

Amended by [ADR 0034](0034-a-review-ends-on-a-result-in-its-overview.md): the result after submitting is a block with Close Change filled, and a local Change ends the same way.

## Context and Problem Statement

Submitting a Review took a quick pick for the verdict, an input box for the summary, and a toast to say it was done. A design critique of the whole extension (2026-10-16) found this the weakest moment of a Review, though it is the only act that can't be undone and the only one others see. The prompts went away as soon as they were answered. Nothing showed which Comments would publish, only how many. The verdict "Feedback Only" was "You commented" everywhere else and "Comment" on GitHub. An empty summary on Request Changes failed only after "Submitting…". The overview, where the Review began, stayed behind it. ADR 0018 had turned down a separate "finish" webview because it would copy the Comments that already show as threads on the diff. Where should a pull request's Review end, and what should the Reviewer see before it publishes?

## Considered Options

- A Submit step in the overview: the verdict, the summary and the pending Comments, one line each, with the result shown there
- Keep the quick pick and input box, renaming the verdict, checking the summary, and listing the Comments as the quick pick's details
- A separate "finish" webview, as ADR 0018 turned down

## Decision Outcome

Chosen option: the Submit step in the overview, because the Review ends on the page where it began, with what it publishes in view, and the result lands where the Reviewer is looking. Prompts that vanish can't show the Comments and their verdict together, and a separate webview would be one more tab.

- **One way in.** Submit Review…, from the overview's header, the command palette, `Ctrl+Alt+R S`, the offer once every file is viewed, a Change's context menu in Change Files and the Dashboard's next step, brings the overview forward with the Submit step open and the focus on its verdict. Change Files and a Change's files no longer carry a finishing button of their own: Show Overview takes the Reviewer there. Tests and scripts that give the command a verdict and a summary still submit straight away.
- **The step.** Under the overview's header: the verdict as Comment, Approve or Request Changes, in GitHub's order and words; the summary for the author; the pending Comments, each as its `path:line`, which opens the Comment's thread in the diff, and its first line, muted; then Submit Review, filled, and Cancel. Ctrl+Enter submits from anywhere in the step, and Escape cancels. No verdict is chosen until the Reviewer chooses one. The verdict and summary are a draft the webview keeps, so they survive the panel hiding.
- **Before GitHub refuses.** Commenting or requesting changes needs something to say, a summary or a Comment. Without either, Submit Review is off and a muted line under the summary says what to add. On the Reviewer's own pull request GitHub takes only a comment, so the step offers Comment alone. A refusal that still comes from GitHub is put in plain words, with the way out, such as signing in.
- **The result.** While GitHub takes the Review, the step's button says Submitting… and the progress bar runs. Then the step closes, the standing line opens with the new verdict, such as `✓ You approved at 14:32 · 3 Comments published`, followed by View on GitHub, and the focus moves to that link. Screen readers hear what was published. No toast. If GitHub refuses, the step stays open with its draft and says why.
- **Only Comments, not code.** A pending Comment shows as its place and its first line of words, never the code around it or a suggestion's code (ADR 0012). Its thread on the diff stays where it is read and edited, so the list amends ADR 0018's reason for keeping Comments out of a webview: it says what publishes, it doesn't copy the threads.
- **A local Change is unchanged.** Write Brief… writes the Brief, which opens in the editor, and copying it ends the Review (ADR 0016, ADR 0018).

### Consequences

- Good, because a Reviewer sees the verdict, summary and every Comment that publishes together, and can open any Comment before submitting.
- Good, because the Review's end lands on the overview, in the standing line the Reviewer already reads, and with the focus.
- Good, because a verdict GitHub would refuse can't be submitted, and the step says why before it is tried.
- Bad, because the overview now has a form, which the webview must keep accessible, and the step's list of Comments must follow the gutter as Comments are added, edited and deleted.
- Bad, because a Reviewer who submitted from the palette without looking now goes through the overview, one more place than a quick pick.
