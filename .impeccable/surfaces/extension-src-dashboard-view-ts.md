---
version: 1
slug: "extension-src-dashboard-view-ts"
primary_target: "extension/src/dashboard/view.ts"
related_targets:
  ["extension/src/dashboard/dashboard.ts", "extension/package.json"]
---

# Dashboard

Scope: the Dear Reviewer side bar in the Reviewer's own windows (issue #38, ADR 0032), replacing the Inbox, Change Files and Findings views there. Mode: Operate. Audience: the Reviewer outside a review, seeing where they stand and starting the next one. Constraints: In progress (Changes open in any window; a row resumes it in the review window, and finishing is the next step, never a row's button), Waiting on you (longest wait on you first), Dependency updates (Dependabot's, apart from Waiting on you and out of its count, longest wait first), Your pull requests, Reviewed by you (these show five rows, then Show all), Local branches (first five, then Show all), Open a commit range…; the Inbox's and the overview's data, never its own.

## Direction contract

THESIS: The Dashboard is a Change overview for every Change at once, sized for the side bar: answer lines, one next step, then the lists. It refuses the dashboard of cards, counters and tabs.

OWN-WORLD: The overview's world at side-bar density: theme variables only, the workbench font, the editor font for branches, hairline rows, 16px avatars at the tree's icon size, tabular numerals, one filled button the width of the side bar.

STORY: The Reviewer clicks Dear Reviewer, sees how much is open and waiting and where they left off, and presses one button to resume in the review window or start the next review.

FIRST VIEWPORT: Facts line, the filled next step (with a place line only when it is a pull request not yet open), a hairline, then In progress and Waiting on you.

FORM: The Home overview's form, moved into the side bar. Signature interaction: the next-step button follows the Review: Resume, then Submit Review… or Write Brief… once every file is viewed, then the longest-waiting pull request; signed out, it is Sign In to GitHub. Motion grammar: only the progress bar along the top while the Inbox loads; updates rebuild in place and keep the focus.
