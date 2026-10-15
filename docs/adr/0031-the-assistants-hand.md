---
status: accepted
date: 2026-10-15
---

# Give the Assistant a hand of its own: a rule, the reading cat and one color

## Context and Problem Statement

The Assistant blended into the editor. Its replies were plain Markdown with no name, the overview's take had only a small "Assistant" heading, and its Findings took the theme's warning color, so they read as warnings. DESIGN.md ruled out an accent color or any mark for the Assistant, to keep away from branded AI chat with gradients, sparkles and a face. A Reviewer couldn't tell at a glance what came from the Assistant and what came from the Reviewer, GitHub or Dear Reviewer itself (issue #53). How can the Assistant be recognisable everywhere it speaks without becoming a character?

## Considered Options

- A rule down the left of what the Assistant says, headed by the reading cat and its name, in a color the extension contributes
- The cat and name only, with no rule or color
- The rule only
- The rule in the theme's warning color, which Findings already use

## Decision Outcome

Chosen option: the rule, the cat and the name, in a contributed color, because together they mark the Assistant in every webview and in the editor with marks the system already had. The reading cat was the status bar's Assistant mark, and the rule is the bar a Finding already draws down the gutter. The cat and name alone left Findings in the warning color. The rule alone gave no name to sighted Reviewers. The warning color would have meant both "the Assistant says" and "billed per token".

- **Color.** `package.json` contributes `dearReviewer.assistantForeground`, which defaults to `charts.purple` in dark, light and both high-contrast theme kinds. A theme or `workbench.colorCustomizations` can set it. It is the only color the extension adds. Webviews use it as `--vscode-dearReviewer-assistantForeground`.
- **The hand.** In the Assistant panel, each reply sits behind a 2px rule in that color, headed by the cat in the color and "Assistant" in `foreground`, and the working line sits behind the same rule. In the overview, one rule holds the take and the Reading Order, headed by the cat and "Assistant", followed by "Since your Review at …" when the take explains new commits.
- **The mark.** The webviews draw the cat from `extension/src/assistantMark.ts`, which holds the path of `media/dear-reviewer.svg` with its coordinates rounded, as one SVG symbol each mark uses. Screen readers skip the cat and read the visible name.
- **Findings.** The Findings tree icon and the overview-ruler mark take `dearReviewer.assistantForeground`. The gutter icons can't take a theme color, so they carry `charts.purple`'s defaults, `#b180d7` for dark themes and `#652d90` for light ones. A theme that sets the color moves the tree icon and the ruler mark, but not the gutter.
- **Not a character.** The Assistant still gets no avatar, face, fill, gradient, glow or sparkle. Its words have no fill, so the Reviewer's filled messages stay the main flow.

### Consequences

- Good, because a Reviewer can tell the Assistant's words from the Reviewer's, GitHub's and Dear Reviewer's at a glance, in both webviews and in the editor.
- Good, because Findings no longer look like the editor's warnings.
- Bad, because the extension now defines a color, and the gutter icons don't follow a theme that sets it.
- Bad, because the cat in the webviews is a copy of the logo's path, which must change with `media/dear-reviewer.svg`, as the logo font already must.
