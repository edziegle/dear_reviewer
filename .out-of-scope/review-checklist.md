# A review checklist for each repository

Dear Reviewer doesn't show a repository's review checklist for the Reviewer to tick before they submit, and we don't plan to add one.

## Why this is out of scope

A checklist helps a Reviewer who forgets things, such as migrations, concurrency, error paths, security or docs. Dear Reviewer already offers a second pair of eyes for that: when the Reviewer asks for Findings, the Assistant looks the Change over for bugs, missed edge cases, security problems and code that misleads, and raises each one on the lines it's about (ADR 0017).

A checklist the Reviewer ticks would add a ritual on top of that. Ticked boxes soon stop meaning the check was done, and a long or generic list gets skipped. It would also need a place of its own in the overview, which already holds the Assistant's take, the Reading Order and the Submit step. It would need a rule for items left open at submit, though the Submit step only stops a Review that GitHub would refuse (ADR 0033). And a local Change, which ends with a Brief rather than a submit, would need a second place for it.

What a checklist adds over Findings is a team's own concerns, the ones a general reading of the code wouldn't raise. A Reviewer who keeps those in a file can ask the Assistant in chat to check the Change against it, since the Assistant reads the worktree's files.

If the request comes back, start from the Assistant applying the repository's review guidance, not from ticks. The guidance would shape the Assistant's take, its Findings and its Briefs, and nothing new would block a submit. The Assistant would have to read the guidance at the base commit, since a pull request can edit the file at its head, and treat it as other people's text (ADR 0042).

## Prior requests

- #117: "Add a per-repository review checklist the Reviewer ticks before submitting"
