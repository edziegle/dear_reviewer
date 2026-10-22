---
status: accepted
date: 2026-10-21
---

# Let the Assistant add an Agent note to a pull request Comment, on request, inside the Comment

## Context and Problem Statement

More and more pull requests are written by agents, and an agent reads the Reviewer's Comments as its instructions. A Comment written for a person is often terse: "Try to avoid using X in Y here." A person fills in the reason and the alternative from context. An agent guesses, and a wrong guess costs another round of review (issue #161).

A local Change has an answer: its Review ends with a Brief, the Reviewer's Comments rewritten by the Assistant as instructions for an agent (ADR 0016). A pull request has nothing comparable, because its Comments go to GitHub as the Reviewer wrote them. The only Assistant text that ever becomes a Comment is a converted Finding (ADR 0017).

The note would go to GitHub under the Reviewer's name, where an agent acts on it, and the Assistant writes it after reading other people's text. How does a pull request Comment get a note for agents, and what keeps that note from carrying more than the Reviewer meant?

## Considered Options

- A command on each pending Comment, **Add Agent Note**, that puts one labeled paragraph under the Reviewer's text, for the Reviewer to read, edit and save
- A follow-up Comment from the Assistant in the same thread
- The Assistant rewriting the Reviewer's Comment for agents
- Notes for every Comment at once when the Reviewer submits, or on by default
- A note hidden from people, such as an HTML comment, or collapsed in a `<details>` block
- Widen the meaning of Brief to cover one Comment

## Decision Outcome

Chosen option: a command on each pending Comment. The Reviewer decides, one Comment at a time, whether an agent needs more than they wrote, and reads the note before it is saved. A submit-time pass or a default would put text under the Reviewer's name that they never asked for, and would make them review every note at the worst moment. A follow-up Comment doubles what GitHub shows and notifies, and leaves the reader to connect it to the Comment it explains, where one Comment keeps the reason next to the request. A rewrite would take the Reviewer's words away from them. A hidden note would be instructions an agent follows that a person can't see. A Brief is a whole local Review packaged for an agent, so a note on one Comment gets its own term, **Agent note**.

- **Where it is offered.** Add Agent Note is in the title bar of every _pending_ Comment on a pull request Change: a new thread, a follow-up in the Reviewer's own thread (ADR 0024), and a reply in another person's thread that went into the pending review (ADR 0014). It is not offered on a published Comment, on a draft that hasn't been saved (ADR 0017), or on a local Change's Comments, where the Brief does the work.
- **Writing.** The Assistant writes the note in a turn the Reviewer doesn't see, in the Change's own conversation, as it does for Findings and the Brief, with progress shown while it runs. The prompt gives it the Reviewer's Comment, the code lines under the thread (the head or the base side, as the thread is placed) and the thread's earlier Comments. Everything but the Reviewer's own text sits in a fence as other people's text (ADR 0042, rule 1). The prompt asks for the reason behind the Comment and what to do instead, concise and specific, with `path:line` references at the head commit where they help. It tells the Assistant to add no request the Comment doesn't make, to take nothing from the code that the Comment doesn't point at, and never to guess the Reviewer's reasons. The Assistant answers with a JSON object that holds either `note` or `noNote` (a one-line reason), and optionally a `warning` when the code or an earlier Comment held instructions. Dear Reviewer reads that object strictly: any other reply is an error, not a note.
- **Declining.** On `noNote`, the Comment doesn't change, and a notification shows the reason. A `warning` shows in a notification too.
- **Checks before insertion** (ADR 0042, rule 4). Dear Reviewer repairs the note before it goes in the Comment, and a notification lists what it repaired:
  - Markdown images and raw image URLs are removed.
  - Invisible Unicode is removed: tag characters U+E0000–U+E007F, zero-width U+200B–U+200D, U+2060 and U+FEFF, and bidirectional controls U+202A–U+202E and U+2066–U+2069.
  - A link, a bare URL or an email address is kept as a link only if the Reviewer's own text or the Change's diff holds that exact one. Any other becomes plain text in a code span, which GitHub doesn't turn into a link. A URL counts wherever it sits, also right after `_`, `*`, `~` or `(`, where GitHub links it too.
  - `@mentions` go in a code span, so GitHub notifies no one. Cross-references go in one too: `#123`, `owner/repo#123`, `GH-123` and the SHA of a commit, alone or as `owner/repo@sha`. GitHub links these, and a reference to an issue or pull request posts an event on it when the Review is submitted, in another repository too. A cross-reference that the Reviewer's own text holds stays. HTML is escaped, so it shows as literal text.
  - A `path:line` or `path:first-last` reference to a file outside the Change's worktree, or to a line the file doesn't have, is dropped, wherever it sits in the note, in a code span or in plain text. The prompt asks for the code span form, and the check does not depend on it.
  - A note over **600 characters**, counted after the repairs and without the label, is refused with a message asking the Reviewer to try again. It is never cut short.
- **Insertion.** The note goes after a blank line under the Reviewer's text, starting with a label that Dear Reviewer writes, never the Assistant: `**For agents:** …`. The Comment then opens for editing with this text. The pending review on GitHub changes only when the Reviewer saves, through the existing Comment edit path. Canceling leaves the Comment as it was. The Assistant never publishes anything (ADR 0042, rule 5).
- **Asking again.** On a Comment that already holds a `**For agents:**` paragraph, Add Agent Note replaces that paragraph and keeps the rest. The paragraph is the label at the start of a paragraph, so "For agents" inside the Reviewer's sentence is not mistaken for it.
- **Edits.** After insertion the text is the Reviewer's own: nothing re-checks it, marks it stale, or rewrites it when they edit the Comment.
- **Races.** If the Comment is deleted while the Assistant writes, the note is dropped. If the Reviewer saved an edit meanwhile, the note goes under the body as it stands when the note arrives, and the URLs it can keep come from that body. Text typed into an edit box is not in the extension's copy of the Comment until the Reviewer saves, and putting the note in would replace it. Add Agent Note does nothing while the Comment is open for editing, and a note that arrives after the Reviewer opened the Comment for editing is dropped. A notification says to save or cancel the edit and ask again.
- **Out of scope.** Notes for every Comment at once, automatic notes, a setting to turn them on, notes on a local Change, Comment severity (#116), and stripping invisible Unicode from text going _into_ the prompt (#163). A Finding becomes a Comment as before.

### Confirmation

- Unit tests for `agentNote.ts` cover each repair and its list, the cap at 600 and 601 characters, the strict reply, and the splice into a body. They include a URL after `_`, `*`, `~` and `(`, cross-references, and a reference in plain text. A prompt test in `prompts.test.ts` shows an injection payload in the code and in an earlier Comment sitting only inside a fence.
- The integration suite `agentNote` runs the whole flow against the fake GitHub and the fake `claude`: the note opens the Comment for editing, GitHub is unchanged until Save, Cancel leaves it as it was, and "no note", a refused note and the races, including a Comment open for editing, behave as above.

### Consequences

- Good, because an agent gets the reason and the alternative, not a guess, and the Reviewer's text stays theirs and comes first.
- Good, because the checks don't depend on the model, and the Reviewer reads every note before it can reach GitHub.
- Bad, because a note is one more thing for the Reviewer to read, and a careless Reviewer could save one the checks let through. The checks hold the known channels (images, links, mentions, HTML, invisible text, bad references), not every sentence a steered model could write.
- Bad, because the note stays after the Reviewer edits their text, and can then disagree with it. They own the text from that point.
- Bad, because text the Assistant wrote goes to GitHub under the Reviewer's name. Path 6 of the threat model widens from a converted Finding to every Agent note.
- Bad, because the Reviewer's text and the note share one body, so editing one means editing the whole Comment.
- Bad, because the label and the 600-character cap are fixed. A setting for either waits for someone to ask.
