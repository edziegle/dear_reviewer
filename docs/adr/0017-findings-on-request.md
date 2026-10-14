---
status: accepted
date: 2026-10-14
---

# Raise Findings only on request, as JSON from the Change's conversation, shown as gutter markers that become draft Comments

## Context and Problem Statement

The Reviewer wants the Assistant's attention on a Change only when they ask for it (spec #45), and each Finding must show as a marker beside its lines, where they drop it or turn it into a Comment, so nothing the Assistant says is published without their decision (#46, #48). ADR 0012 puts Findings in the editor as comment threads or decorations, listed in a tree view. The Assistant runs as one long-lived `claude` process per Change, in the Change's conversation (ADRs 0004 and 0009), and reads other people's code, so its output can't be trusted. How does Dear Reviewer ask for Findings, read them, show them and turn them into Comments?

## Considered Options

- Ask in the Change's conversation for a JSON reply, show each Finding as a gutter decoration and in a Findings view, and convert one into a draft Comment that the Reviewer saves
- Run a separate `claude -p` with `--json-schema` for each request
- Show Findings as comment threads from a second comment controller

## Decision Outcome

Chosen option: a JSON reply in the Change's conversation, gutter decorations, a Findings view and draft Comments. The conversation already knows what the Reviewer and the Assistant discussed, as it does for a Brief (ADR 0016). A JSON schema is a flag of the whole `claude` process, so it would need a second process and a second session for every request. A comment thread, even collapsed, opens as a widget inside the diff, and threads from another controller would look like the Reviewer's own.

- Find Issues runs only when the Reviewer asks for it, from the command palette or the Findings view's title bar. It asks the Change's Assistant, in its own conversation, after whatever it is busy with, for a JSON object `{"findings": [{"path", "side", "startLine", "endLine", "message"}]}`, with the diff and the changed files in the prompt. The panel doesn't show the reply. It gets a note with the number of Findings instead.
- Dear Reviewer trusts nothing in the reply. It reads the JSON object even inside a Markdown fence or after a sentence. A reply without one leaves the earlier Findings in place, with an error message. It keeps at most 50 Findings, cuts each message to 2,000 characters, and keeps a Finding only when all of these hold:
  - its side is `head` or `base`;
  - its path, relative or absolute, names a file inside that side's worktree, even after symbolic links are resolved;
  - its lines are whole numbers that the file has;
  - its lines fall within one section of that side's diff, with three lines of context, the only lines GitHub takes a Comment on.

  The note says how many were left out.

- Each Finding shows as a gutter icon on its lines, with a mark in the overview ruler, in every visible editor of its side's file, including those of the diff. Nothing is drawn in the text. Hovering its lines shows the message as escaped plain text, with links to convert it into a Comment or drop it. Those two commands are the only ones the hover may run.
- The Findings view lists each Change's Findings, with their message, `path:line` and side. Clicking one opens its file at its lines, and its buttons convert or drop it. Both commands also act on the Finding under the cursor.
- Asking again replaces the Change's Findings. They stay until the Reviewer drops or converts them, asks again, or closes the Change. They live in memory only, so a reload clears them.
- Convert opens a draft Comment at the Finding's side and lines, through Dear Reviewer's one comment controller, pre-filled with the message and in editing mode, and removes the Finding. Nothing is saved until the Reviewer presses Save. The draft then goes through the same pending-review interface as any Comment: a pull request's pending review on GitHub, or a local Change's storage. Cancel drops the draft. Only submitting the Review publishes anything (ADRs 0007 and 0016).

### Consequences

- Good, because the diff stays clean until the Reviewer asks, and a Finding never reaches GitHub until the Reviewer saves it as their own Comment and submits the Review.
- Good, because Findings draw on the Change's conversation, and later chat turns can discuss them.
- Good, because a Finding that can't become a Comment, such as one outside the diff or outside the worktrees, never shows.
- Bad, because the JSON comes from a prompt, not a schema, so a reply that isn't JSON wastes a turn.
- Bad, because a Finding on code the diff doesn't show, such as a caller elsewhere that the Change breaks, is left out.
- Bad, because Findings are lost on reload, and a Finding's hover shows only when the pointer is on its code, not on its gutter icon.
- Bad, because a request for Findings uses a Claude turn in the Change's conversation, and a long conversation makes that turn larger.
