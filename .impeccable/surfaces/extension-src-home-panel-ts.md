---
version: 1
slug: "extension-src-home-panel-ts"
primary_target: "extension/src/home/panel.ts"
related_targets: []
---

# Home

Scope: the review window's Home webview (issue #38, ADR 0025). Mode: Operate. Audience: the Reviewer between Changes, choosing what to do next. Constraints: In progress, Waiting on you (longest wait on you first, counted from the review request), Your pull requests, Local branches; the Inbox's and the overview's data, never its own.

## Direction contract

THESIS: Home is a Change overview for all Changes at once: answer lines, one next step, then the lists. It refuses the dashboard of cards, counters and tabs.

OWN-WORLD: The overview's world unchanged: theme variables only, workbench font, editor font for refs and branches, sticky header on editor ground, hairline rows, 24px avatars, tabular numerals, one filled button.

STORY: The Reviewer sees how much is open and waiting, where they left off, and presses one button to resume or start the next review.

FIRST VIEWPORT: Sticky header: "Home" title, Refresh icon. Facts line: "2 in progress · 5 waiting on you · oldest 6 days". Place line: where they left off. Button row: the one filled next step, Resume or Start. Hairline, then In progress rows, then Waiting on you.

FORM: Home as an overview, 7th of 7 on the re-rolled list, seed 9e06f647 re-roll 1. Signature interaction: the next-step button follows the Review: Resume, then Finish Review… once every file is viewed, then the longest-waiting pull request. Motion grammar: none; updates rebuild in place and keep the focus.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
