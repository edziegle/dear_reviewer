---
status: accepted
date: 2026-10-14
---

# Suggest a Reading Order with the summary, in steps, and let the Reviewer step through it or go back to tree order

## Context and Problem Statement

Change Files lists a Change's files as a directory tree, and Next unviewed file follows that order. For a Change of more than a few files, alphabetical order rarely matches the order that makes sense: the interface before its callers, the core change before the plumbing, tests last. The overview's summary names one `path:line` to start at (ADR 0019), but nothing about what to read after it (issue #23). Should the Assistant suggest an order, when, and where does the Reviewer see and use it?

## Considered Options

- Suggest the order with the summary when a Change opens, in steps, shown in the overview and as a sort mode of Change Files
- Suggest it only on request, as with Findings (ADR 0017)
- Show it in the overview only, leaving Change Files and stepping in tree order

## Decision Outcome

Chosen option: with the summary, in steps, in the overview and as a sort mode. A Reading Order shapes how the Reviewer reads, as the summary does, and says nothing about whether the code is good, so it doesn't need to wait for a request the way Findings do. Asking on request would also let the summary's start point and the order disagree. An order shown only in the overview would leave Next unviewed file walking a different order from the one the Reviewer was just shown.

- When a Change opens, the Assistant writes the Reading Order in the Change's conversation, in the turn after its summary, starting from the summary's start point. It is a JSON object of steps, each with a short label and the files to read in it, each file with a few words on why. Dear Reviewer moves the summary's start file to the front if the reply put it elsewhere, so the two never disagree. This amends ADR 0019.
- Dear Reviewer trusts nothing in the reply. It keeps only paths that are among the Change's changed files, drops duplicates, caps labels and reasons at a short length, and adds any changed file the Assistant left out in a last step, in tree order. A reply without a usable order leaves the Change in tree order, with no error in the Reviewer's way.
- The overview lists the Reading Order under the Assistant's take: each step's label, then its files, each linking to its diff with its reason, and viewed files checked off.
- Change Files gains a sort mode, Reading Order or Tree, switched from its title bar. Reading Order lists a Change's steps with their files flat beneath them. Next unviewed file and Previous unviewed file follow whichever mode is showing. Tree stays the default until a Reading Order exists.
- The Reviewer can't reorder the files by hand. Switching to Tree is how they set the order aside.
- A Reading Order belongs to the head it was written for. After new commits it stays, marked out of date, and files changed since go in a last step, "Since the suggestion". The Assistant writes a new one only when the Reviewer asks.

### Consequences

- Good, because a Reviewer can read a large Change as a story, and stepping from the overview or the keyboard follows the same story.
- Good, because the Reading Order starts where the summary says to start.
- Bad, because every Change that opens costs one more Claude turn, even one the Reviewer reads in tree order.
- Bad, because the JSON comes from a prompt, not a schema, so a malformed reply leaves the Change in tree order.
- Bad, because an out-of-date order can put new files in a poor place until the Reviewer asks again.
