---
status: accepted
date: 2026-10-17
---

# Show the Assistant in the Secondary Side Bar, following the Change in front

## Context and Problem Statement

The Assistant's chat was a webview panel in an editor tab beside the diff, one for each Change whose Assistant the Reviewer opened (ADR 0012). A tab competes with the diff for the editor's width, and the Reviewer reads code and asks about it at the same time. Showing a Change closed every other Change's chat (ADR 0020), so only one chat was ever open anyway. VS Code's Secondary Side Bar holds views beside the editor, out of its way. In VSCodium 1.135, which Dear Reviewer requires, an extension can contribute a view container to it with `contributes.viewsContainers.secondarySidebar`, without a proposed API. Where should the Assistant's chat go (issue #84)?

## Considered Options

- A webview panel in an editor tab, one for each Change, as before
- A webview view in the Secondary Side Bar, which shows the conversation of the Change in front
- A webview view in the Dear Reviewer side bar, beside Change Files and Findings

## Decision Outcome

Chosen option: a webview view in the Secondary Side Bar, because the chat then sits beside the diff without taking its width, and the Reviewer can drag it elsewhere as with any view. The Dear Reviewer side bar already holds Change Files and Findings, which the Reviewer keeps open while reading, and the chat needs height they would give up.

- **Where.** The Secondary Side Bar has a view container, Assistant, with one webview view, Assistant (`dearReviewer.assistant`). The view shows where Change Files and Findings do: in the review window, or in a window that holds a Change itself. With no Change open, it is hidden.
- **Which conversation.** A view is one for the window, and a conversation belongs to one Change (ADR 0009), so the view shows one conversation at a time: the Change in front's. When another Change comes to the front, the view moves to its conversation. Show Assistant, Ask the Assistant and Send Selection to Assistant show the conversation of the Change they act on, which can be other than the one in front, until another Change comes to the front. Every Change's `claude` process and conversation keep going while the view shows a different Change's, so a reply still being written isn't lost.
- **When it opens.** ADR 0019 stands: the view opens only when the Reviewer asks, through the commands and the overview's Ask the Assistant, which open the Secondary Side Bar if it is closed and put the cursor in the message box. Showing a Change doesn't close the view: if the Reviewer keeps it open, it shows each Change in front in turn. If the view is in sight when a Change whose Assistant hasn't started comes to the front, such as after a reload, the Assistant starts.
- **The view's title** reads Assistant, with the Change's name beside it, and the heading in the view repeats it with the Change's commits.
- **What the Reviewer is writing** to one Change's Assistant stays in the webview while it shows another Change's conversation, and comes back with it.
- **The editor-tab panel goes.** Keeping both would mean two hosts for one conversation.

This amends ADR 0012, whose Assistant was a panel in an editor tab, ADR 0019, whose Assistant's panel opened beside the overview, and ADR 0020, under which showing a Change closed the other Changes' Assistant chats.

### Consequences

- Good, because the Reviewer reads the diff and the chat side by side, at the editor's full width.
- Good, because the chat follows the Change in front, as Change Files and Findings do, so the side bars and the editor agree on one Change.
- Bad, because the Secondary Side Bar is narrower than an editor tab, so long code blocks in a reply scroll sideways more often.
- Bad, because a command run while the view has the focus acts on the Change of the file or overview in front, not the view's: VS Code doesn't say which view has the focus.
