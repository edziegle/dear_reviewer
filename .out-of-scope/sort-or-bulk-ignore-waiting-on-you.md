# Re-sorting Waiting on you, or ignoring many rows at once

The Dashboard's Waiting on you list stays in one order, the longest wait first, and Ignore stays one row at a time. We don't plan to add another sort, saved or for the session only, or a way to ignore more than one pull request at a time.

## Why this is out of scope

The order is the Next Step Rule. When no Change is in progress, the Dashboard's one filled button reviews the pull request that has waited longest, and that pull request is the list's first row. A sort by size or by check status would put another pull request at the top while the button still names the one that waited longest, so the list and the next step would disagree, and the Reviewer could no longer trust the one button without checking.

A long Waiting on you is a backlog on GitHub, and GitHub is where to clear it: declining or removing the review request tells the author, and the pull request leaves the list on the next refresh. Ignore is for something else. It sets aside the odd pull request on the Reviewer's machine only, while the request stays on GitHub. Ignoring many at once would make Ignore a way for the Reviewer to hide a queue from themselves while its authors still wait.

Bulk Ignore, such as "Ignore all below this point", would also be the only action in the Dashboard's lists that acts on more than one row, and it would need a way to choose rows that the side bar doesn't have.

If a Reviewer with a real backlog finds it hard to clear, start from the GitHub side: a way to remove a review request from the Dashboard, not a second order or bulk Ignore.

Dependency updates have a list of their own under Waiting on you (ADR 0051). That doesn't re-sort Waiting on you: no one is waiting on a bot, so its pull requests leave the list, and each list keeps the longest wait first.

## Prior requests

- #182: "No way to re-sort or bulk-clear a large Waiting on you backlog on the Dashboard"
