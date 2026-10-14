---
status: accepted
date: 2026-10-13
---

# Show the Change's code only in VS Code's editors, never in a webview

## Context and Problem Statement

The official GitHub Pull Requests extension builds much of its review UI from webviews, such as its Description page and timeline (`docs/research/review-code-navigation.md`, section 1.4). On moderate diffs those webviews are slow, and they feel, and sometimes look, wrong next to the rest of VSCodium. Code drawn in a webview is a copy of the editor: it has no navigation, no editor selection and no comment threads, and the larger the diff, the slower it gets. Dear Reviewer exists so the Reviewer reads a Change in the real editor (ADR 0001). Its Assistant and timeline panels are webviews already, and coming features (review threads, Findings, Briefs, what changed since the last Review) could reach for one. Where may Dear Reviewer show the Change's code?

## Considered Options

- Show the Change's code only in VS Code's editors, and show no code in webviews beyond plain quotes
- Show code in webviews where it's convenient, with syntax highlighting
- Use no webviews at all

## Decision Outcome

Chosen option: show the Change's code only in VS Code's editors, because the editor is fast on large diffs, looks like the rest of VSCodium, and gives navigation and comment threads on real worktree files.

- No webview presents the Change's code as code: no files, diffs, hunks, line numbers or syntax highlighting.
- A message in a webview may quote a few lines, such as a fenced block in an Assistant reply or a GitHub Comment, as plain text in the editor's font. `path:line` references in it open the code in the editor (ADR 0011).
- The timeline shows a review thread as its author, a summary and a `path:line` link that opens that line in the diff editor. The thread itself, with its diff hunk and any suggestion, appears only as a native comment thread on the diff.
- Findings appear in the editor as native comment threads or decorations on their lines, and are listed in a tree view.
- A Brief opens as a Markdown text document in the editor, where the Reviewer reads and edits it before sending it.
- What changed since the last Review opens as a native multi-file diff from the last reviewed head to the new head, with `vscode.changes`. The Assistant may summarise it in prose, but its panel shows no diff.
- Beyond code, Dear Reviewer uses VS Code's native UI first: editors, tree views, comment threads, quick picks and the status bar. An ADR that adds a webview says why none of them fits. The Assistant panel is a webview because VSCodium has no usable native chat surface: VS Code's chat API depends on the Copilot chat UI. The timeline is a webview because no native view shows its mix of prose, avatars and check statuses well.

### Consequences

- Good, because the Reviewer reads and navigates the Change's code only in the editor, however large the diff.
- Good, because what a webview draws grows with the conversation or the timeline, not with the size of the diff.
- Bad, because native APIs are more limited than HTML, so some features cost more to build and look plainer.
- Bad, because a code block in an Assistant reply has no syntax highlighting.
- Bad, because reading a review thread means leaving the timeline for the diff.
