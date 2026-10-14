---
status: accepted
date: 2026-10-14
---

# Open every Change with an overview that orients the Reviewer, holding a short summary, and keep the Assistant's panel closed until asked

## Context and Problem Statement

Opening a Change opened its diff, a timeline tab for a pull request, and the Assistant's panel in front of it, which wrote a long summary of what the Change does and where its risk is. The Reviewer was thrown in: two tabs to sort out, a summary that retold the diff they were about to read, and nothing saying how big the Change is, where they stand on it or where to start. A local Change, such as an agent's branch, got the Assistant's summary but no history. What should a Reviewer see first, beside the diff, and how long should the Assistant's summary be?

## Considered Options

- An overview at the top of the timeline panel, for every Change, holding a one-paragraph summary, with the Assistant's panel opening only when asked
- A one-time "start here" card at the top of the panel, with the timeline alone after that
- Native UI only: the Change's row in Change Files and its tooltip carry the summary

## Decision Outcome

Chosen option: the overview, because it answers the questions a Reviewer has when a Change opens in one place, beside the diff, every time, and it gives teammates' pull requests and agents' branches the same start. A one-time card would leave later opens without bearings. A tooltip can't hold a paragraph or links to code, and a Change's row is already busy with its actions.

- The timeline panel becomes the Change's overview and opens for every Change, a local one included. Its tab is named after the Change, such as `acme/api #482` or the branch. Show Timeline is now Show Overview, and the Change's row in Change Files opens it. This amends ADR 0008.
- From the top, the overview shows: the title and a byline (`acme/api #482 · octocat → main`, or the repository and commit count of a local Change); the size (`12 files · +340 −58`) and the checks' status; where the Reviewer stands (new commits since their Review, pending Comments, files viewed), from the same facts as the Change's row; the Assistant's take; then Next unviewed file and Ask the Assistant. The history follows: a pull request's timeline from GitHub, or a local Change's commits from git, oldest first.
- The header holds Refresh and the button that finishes the Review: Submit Review… for a pull request, Write Brief… for a local Change.
- The Assistant's summary is one short paragraph: at most three sentences and about 60 words, saying what the Change does and where to start reading, as one `path:line` reference. It doesn't retell the files or list risks; Findings do that, on request (ADR 0017). In the overview, only references to the Change's own files become links, so a wrong path is plain text rather than a dead link.
- When the Change has new commits since the Reviewer's last Review, the Assistant's explanation of what changed takes the summary's place, labelled with the commit it is since, and is as short. This amends ADR 0015, which showed it in the Assistant's panel.
- The Assistant starts when a Change opens, in the Change's conversation, so later questions have the summary as context, but its panel opens only from Ask the Assistant, Show Assistant or Send Selection to Assistant. Its chat starts with a note that the summary is in the overview. This amends ADR 0004 and ADR 0009, whose conversation now keeps the summary and the last explanation for the overview.
- While the Assistant writes, the overview says so in a muted line that screen readers hear. When `claude` is missing or signed out, the overview says so in a muted line with a button that helps, and the rest of the overview still works.

### Consequences

- Good, because a Reviewer opening a Change sees what it is, how big, where they stand and where to start, in one panel, with the diff still in front.
- Good, because the summary no longer retells what the diff shows, so it is read rather than skipped.
- Good, because local Changes get a history and the same start as pull requests.
- Bad, because a summary of three sentences leaves out detail some Reviewers want; they ask the Assistant for it.
- Bad, because a conversation saved before this decision has no separate summary, so its overview shows the first, long reply until the Change's next Review.
- Bad, because the overview's standing line is one more thing to keep up to date as the Reviewer marks files viewed and comments.
