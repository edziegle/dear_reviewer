---
status: accepted
date: 2026-10-14
---

# Take a pull request's last Review from GitHub's record of the commit it covered

Amended by [ADR 0016](0016-local-comments-and-briefs.md): a local Change's last Review is the one its last Brief ended, so it gets the diff, the explanation and the Inbox mark too.

## Context and Problem Statement

A Change can have more than one Review as new commits arrive. The spec asks Dear Reviewer to remember which head commit each Review covered (#23), to show a diff of only what changed since the Reviewer's last Review, to have the Assistant explain that in plain words (#40), and to mark Inbox entries that changed since (#11). ADR 0009 left the explanation to this work, and ADR 0012 says the diff opens with `vscode.changes`, from the last reviewed head to the new head. Where is the reviewed commit kept, how does the diff get the old side's files, and when does the Assistant explain?

## Considered Options

- GitHub's record: each submitted review has the commit it covers (`PullRequestReview.commit`), and Dear Reviewer starts its pending reviews at the Change's head
- The extension's storage: save the Change's head under its conversation name when the Reviewer submits
- Both: the extension's storage, falling back to GitHub when nothing was saved

## Decision Outcome

Chosen option: GitHub's record, because GitHub already keeps it, it follows the Reviewer to their other machine, and it includes Reviews submitted on github.com. Only GitHub's record lets the Inbox mark pull requests that the Reviewer never opened on this machine. Keeping a second copy in the extension's storage would mean deciding which copy wins when they disagree.

- A pending review that Dear Reviewer starts, with the first Comment or with an empty Review, passes the Change's head as `commitOID` to `addPullRequestReview`. GitHub then records the commit the Reviewer was reading, not whatever GitHub's head was at that moment. This amends ADR 0007.
- The last Review is the Reviewer's latest review in a submitted state (approved, changes requested, commented or dismissed), read with `reviews(last: 1, author: <login>, states: …)`. The Reviewer's login comes from one `viewer` query for each API URL and token.
- The Inbox query reads the same field for each pull request. An entry whose last reviewed commit isn't the pull request's head says "new commits since my Review", and hovering over it names the reviewed commit. Submitting a Review refreshes the Inbox.
- Show Changes Since My Last Review opens a multi-file diff from the reviewed commit to the Change's head. The new side is the head worktree's file, so navigation and Comments work there. The old side is the file at the reviewed commit, which a read-only `dear-reviewer-commit:` document gives with `git show`. That document runs git only in the repository of an open Change, and only for a full commit id. If the reviewed commit isn't in the clone, Dear Reviewer fetches it by id from the pull request's remote.
- When the Assistant starts for a pull request Change, or moves to a newer head (ADR 0009), and the Change's head isn't the reviewed commit, the Assistant explains what changed since. Its panel shows a note that names the reviewed commit, then the Assistant's reply. The prompt holds the commits, the changed files and the diff since the reviewed commit. The saved conversation keeps the pair of commits it explained, so a reload or reopening doesn't explain them again.
- A local Change has no Reviews to compare with until a Brief ends one (issue #13), so it gets no diff, explanation or mark yet.

### Consequences

- Good, because a Review submitted on github.com or on the other machine counts, and the Inbox shows changes since it without opening the pull request.
- Good, because the Reviewer reads only the new code in the editor, with navigation on the new side, and the Assistant's explanation in its panel holds no diff (ADR 0012).
- Bad, because a pending review started on github.com, or at an older head of the Change, covers that older commit, so the diff since it shows more than the Reviewer last read. It never shows less.
- Bad, because the old side of the diff isn't a worktree, so go to definition and find usages don't work there.
- Bad, because after a force push the reviewed commit isn't an ancestor of the head, and the diff also shows whatever changed on the base branch meanwhile.
- Bad, because every Inbox load and every Assistant start for a pull request Change asks GitHub for the last Review, and the first one after sign-in also asks for the Reviewer's login.
- Bad, because the Assistant explains on its own, which uses a Claude turn each time a Change opens at new commits since a Review.
