---
status: accepted
date: 2026-10-23
---

# Use a webview where native UI hides a feature, if it is as fast as a native view

## Context and Problem Statement

ADR 0012 keeps the Change's code in VS Code's editors, because webviews that draw code are slow on moderate diffs and lose navigation, selection and comment threads. It also put native UI first for everything else: an ADR that adds a webview has to say why no native view fits. The reason for that rule was rendering speed: the official GitHub Pull Requests extension's webviews are slow, and Dear Reviewer was not to repeat that.

Native UI has since hidden features from the Reviewer, the author included:

- A Finding's message, Convert to Comment and Dismiss are in a hover that shows only when the pointer is over the line's text. Its gutter lightbulb looks clickable, but a gutter decoration can't be clicked or hovered (#198).
- A view's title-bar buttons show only while the pointer is over the view, so Previous Finding and Next Finding there would stay hidden (#199).
- The Findings view's tree shows one line of each Finding, with the rest in a plain tooltip, and nothing can be pinned to the bottom of it (#201).

In each case a native view fits by the letter of ADR 0012, but it hides what the Reviewer needs. A prototype of the Findings view compared the native tree with four webview layouts, and the tree came last (#201). When is a webview the right choice for something other than code?

## Considered Options

- Keep ADR 0012's rule: a webview only where no native view fits
- Use a webview where native UI would hide a feature or make it hard to use, held to a native view's speed and feel
- Use webviews wherever they look better

## Decision Outcome

Chosen option: a webview where native UI would hide a feature or make it hard to use, held to a native view's speed and feel. It fixes the features native UI hid, and it keeps what the native rule was for: speed, and an extension that looks like part of the editor.

- The Change's code is only ever shown in VS Code's editors. ADR 0012 still holds for code: no webview draws files, diffs, hunks, line numbers or syntax highlighting.
- Native UI comes first where it does the job well. A webview is right where the native version would hide what the Reviewer needs, or make it hard to reach or read. The ADR that adds the webview names what native UI would hide.
- A webview is as fast as a native view:
  - It draws its content from the state the extension sends it, without waiting on GitHub or the Assistant inside the page.
  - An update rebuilds only what changed.
  - It stays quick at the largest size its content can reach, such as 50 Findings or a Change with hundreds of files.
  - It is plain TypeScript and the DOM, with no UI framework, as the webviews are today.
- A webview feels like a native view: its colors come from the theme's `--vscode-*` variables (DESIGN.md, the Borrowed Ink Rule), its density is the editor's, it works fully from the keyboard, and a screen reader can name and reach everything in it.

### Consequences

- Good, because a feature can show what the Reviewer needs to see, instead of hiding it behind a hover or a tooltip.
- Good, because the rule now names the reason it exists, speed, and gives each new webview a bar to meet.
- Bad, because each webview has to build and test the keyboard handling, screen-reader support and density that a native view already has.
- Bad, because a webview beside native views can look out of place unless it copies their density closely, as a webview Findings view under the Change Files tree has to.
