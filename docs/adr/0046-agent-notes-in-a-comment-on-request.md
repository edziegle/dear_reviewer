---
status: accepted
date: 2026-10-20
---

# Let the Assistant add an Agent note to a pull request Comment, on request, inside the Comment

## Context and Problem Statement

More pull requests are written by agents, and an agent reads the Reviewer's Comments as its instructions. A Comment written for a person is terse, and an agent guesses the reason and the alternative, which costs another round of review (issue #161). A local Change has the Brief (ADR 0016), but a pull request's Comments go to GitHub as the Reviewer wrote them. Rule 5 of ADR 0042 says only the Reviewer publishes. How can the Assistant help a Comment speak to an agent without publishing words the Reviewer didn't mean?

## Considered Options

- The Assistant appends an Agent note under the Reviewer's text, in the same Comment
- The Assistant writes the note as a follow-up Comment in the same thread
- The Assistant rewrites the Reviewer's Comment for agents
- Notes for every pending Comment at once, when the Reviewer submits
- Notes on every Comment automatically, by a setting or for authors that look like agents

## Decision Outcome

Chosen option: an Agent note in the same Comment, written when the Reviewer asks for it on one pending Comment.

- One Comment keeps the reason next to the request, which is what an agent needs. A follow-up Comment doubles what GitHub shows and notifies, and leaves the reader to connect the two. A rewrite would take the Reviewer's words away from them.
- On request, one Comment at a time, the Reviewer reads each note while the Comment is fresh. At Submit they would read a dozen notes in a row just as they want to be done, which is when reading gets careless, and that reading is the control against a steered note. Automatic notes need a setting or a guess about who wrote the pull request.

How it works:

- **Add Agent Note** is offered on any pending Comment of a pull request: a new thread, a follow-up in the Reviewer's own thread (ADR 0024), or a reply that went into the pending review (ADR 0014). A reply that published at once isn't pending, and gets no note. A local Change gets no notes, because the Brief does this job there.
- The Assistant writes the note in the Change's conversation, in a turn the Reviewer doesn't see, from the Comment, the code under it and the thread's earlier Comments, all fenced as other people's text except the Reviewer's own. It gives the reason behind the Comment and what to do instead, with `path:line` references at the head commit where they help. It adds no request the Comment doesn't make, takes nothing from the code that the Comment doesn't point at, and never guesses the Reviewer's reasons.
- The Assistant can reply that the Comment needs no note, with a one-line reason: the Comment already says everything, or nothing tells it why. Dear Reviewer shows the reason and leaves the Comment as it is.
- Dear Reviewer puts the note after a blank line, behind a label it writes itself, so the label is always the same and the note can be found in the body later:

  ```markdown
  Try to avoid using X in Y here.

  **For agents:** X shouldn't be used for Y because <reason>. Use <alternative> instead, as in `src/foo.ts:42`.
  ```

  The note stays visible. An HTML comment or a collapsed block would hide from people instructions that an agent follows.

- Before the note goes into the Comment, Dear Reviewer checks it, under rule 4 of ADR 0042. It repairs what it can and says what it repaired. It strips images and invisible Unicode. It leaves a URL as plain text unless the Reviewer's text or the diff holds it. It escapes `@mentions`, which would notify someone, and HTML. It drops a `path:line` outside the Change. It refuses a note over 600 characters rather than cutting it, since a cut note could say something else.
- The Comment then opens for editing, and nothing changes in the pending review until the Reviewer saves. Asking again replaces the paragraph after the label. A note the Reviewer edits is theirs, and isn't checked again.

### Consequences

- Good, because an agent gets the reason and the alternative it would otherwise guess, and a person reading the pull request sees the same text.
- Good, because the Assistant still publishes nothing: the Reviewer asks, reads, edits and saves, then submits.
- Good, because the checks hold when the Reviewer reads too fast or the model has been steered.
- Bad, because text the Assistant wrote goes to GitHub under the Reviewer's name. Path 6 of the threat model widens from a converted Finding to every Agent note, and the Reviewer's reading stays the last check on what the note says.
- Bad, because the Reviewer's text and the Assistant's share one body, so editing one means editing the whole Comment.
- Bad, because a Reviewer who edits their text after the note can leave a note that no longer matches.
