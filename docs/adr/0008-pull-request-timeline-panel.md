---
status: accepted
date: 2026-10-13
---

# Show a pull request's timeline in a panel that opens with its Change

Amended by [ADR 0019](0019-change-overview.md): the panel is now every Change's overview, a local Change's included, with its commits as history. It opens in front, alone, holding the Assistant's short summary, and Show Timeline is now Show Overview.

## Context and Problem Statement

The spec asks for a timeline of each pull request: its description, commits, Comments and reviews with their authors' avatars, and the check status of the latest commit with a link to each check's details. The Reviewer reads code in the diff, and the Assistant panel already sits beside it (ADR 0004). When does the timeline open, where does it go, and how does it get its data and open its links?

## Considered Options

- A webview panel per pull request Change that opens with the Change, in the same side group as the Assistant, behind it, plus a Show Timeline command
- A webview panel that opens only through a command
- A webview view in the Dear Reviewer side bar, showing the timeline of the active Change

## Decision Outcome

Chosen option: a panel that opens with the Change, behind the Assistant. The Reviewer reads the timeline before the diff, as in JetBrains, but reads the Assistant's summary first. Neither panel takes focus, so the diff stays the active editor. A side bar view would compete with the Inbox and Change Files views for height, and would need to track the active Change when more than one is open.

- The timeline opens when Dear Reviewer shows a pull request Change's diff, and closes when the Reviewer closes the Change. A local Change has no timeline. Show Timeline reopens the panel after the Reviewer closes it, and reloads it.
- One GraphQL query reads the timeline and the checks: `timelineItems` with the item types `PULL_REQUEST_COMMIT`, `ISSUE_COMMENT` and `PULL_REQUEST_REVIEW`, plus `statusCheckRollup` on the latest commit. Checks cover both check runs and commit statuses, and the query reads the first 100 of them.
- The description comes first, then the items in GitHub's order. The timeline leaves out pending reviews: the Reviewer's own pending review shows as comment threads on the diff (ADR 0007), and GitHub hides other people's.
- The timeline reloads when the Reviewer presses Refresh in the panel, after they submit a Review, and after sign-in or a change of API URL. It does not poll.
- Avatars come from the Inbox's avatar cache, and the webview loads them through `asWebviewUri`. Its content security policy lets it load images from that folder only.
- The panel shows descriptions, Comments and review summaries as plain text, not rendered Markdown, so no HTML from GitHub reaches the webview. ADR 0011 changes this: the extension renders them from Markdown and sanitises the HTML, and links in them open through the extension.
- The webview opens no links itself. It asks the extension, and the extension opens a link with `vscode.env.openExternal` only when the link uses `http` or `https` and came from the extension: the pull request's URL or a check's details page.
- As with the Assistant panel, the extension sends the whole state, and the webview replies `ready`, then `rendered` with the revision it rendered. Tests assert that state.

### Consequences

- Good, because opening a pull request shows its history and checks without a further click, and the diff stays in front.
- Good, because a compromised or buggy webview has no way to open arbitrary URLs or run commands through links.
- Bad, because descriptions and Comments show their Markdown source until a later ticket renders it safely.
- Bad, because a timeline left open goes stale until the Reviewer refreshes it.
- Bad, because a commit with more than 100 checks shows only the first 100.
