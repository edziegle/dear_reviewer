---
status: accepted
date: 2026-10-16
---

# Draw the Code Flow in a webview

## Context and Problem Statement

ADR 0012 keeps a Change's code in VS Code's editors and allows a webview only where no native view fits. Code Flow draws how the code a Change touches calls, and is called by, the code around it, as boxes joined by arrows. Does a native view fit?

## Considered Options

- A tree view of changed symbols with the code that calls them and the code they call
- VS Code's own Call Hierarchy view
- A webview panel in an editor tab beside the diff

## Decision Outcome

Chosen option: "A webview panel in an editor tab beside the diff", because neither native view can draw it. A tree shows one symbol's calls at a time, not how all the changed symbols connect, and the Call Hierarchy view starts from one symbol the Reviewer picks, not from a Change. The panel shows no code: each symbol is a name and a place, and selecting one jumps the diff, which stays in the editor (ADR 0012). It sits in a tab because a diagram needs width the side bar lacks. A list view of the same symbols and calls is there for a screen reader, since a drawn graph can't be read in order.

### Consequences

- Good, because the Reviewer sees the shape of a Change's calls at once, and the real code stays in the real editor.
- Bad, because it is another webview to keep in step with the theme, high contrast and the keyboard. It shares the Markdown panel's handshake, styles and focus script with the other webviews.
- Bad, because VS Code can't say whether a call hierarchy provider exists, so "no language server" is judged from what comes back, and shown as a best guess.
