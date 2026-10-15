---
status: accepted
date: 2026-10-14
---

# Let the editor ask once whether to trust the review window, and make one Trust cover every Change

## Context and Problem Statement

ADR 0010 had Dear Reviewer explain Restricted Mode and offer Manage Workspace Trust whenever the review window started untrusted. That warning came back on every start, with no way to dismiss it for good (#20). Trusting the review window is a real tradeoff: the reviewed code's workspace settings and tasks then apply in it, including for pull requests from strangers. It should be the Reviewer's choice, asked once.

No API grants trust. The editor trusts a folder when it, or a folder above it, is on its list of trusted folders. Its Trust button, in its own startup prompt and at the top of Workspace Trust, trusts the window's current folders and its workspace file. The review window's first folder used to be a home folder beside the folder of Changes, so that Trust covered only the Changes open at that moment. Each later Change brought the editor's prompt about untrusted folders back. Trusting the folder of Changes itself took Add Folder in Workspace Trust, a native file dialog that can't take a pasted path, opened in the wrong folder.

How does the Reviewer trust the review window once, with one click, for every Change to come?

## Considered Options

- Make the folder of Changes the review window's first folder, and let the editor's own prompt ask once
- The same, with Dear Reviewer also asking once, with its own explanation, when a Change first opens
- Copy the folder of Changes' path and send the Reviewer to Add Folder in Workspace Trust
- Keep the warning on every start

## Decision Outcome

Chosen option: make the folder of Changes the review window's first folder, and let the editor's own prompt ask once, because one click in the editor's Trust then covers every Change, and the Reviewer sees one prompt instead of two.

- The review window's first folder is `changes` in the extension's storage, which holds every Change's worktrees. Its own listing is hidden by a `files.exclude` in its `.vscode/settings.json`, so the Changes show only as folders of their own. The workspace file stays in `review-window`.
- The editor asks whether to trust the review window the first time it opens, as it does for any untrusted workspace, and remembers the answer. Dear Reviewer doesn't ask too.
- Trust the Review Window… shows Workspace Trust in the review window, where Trust trusts it. From another window, it brings up the review window, which shows Workspace Trust once it has focus.
- An untrusted review window shows a quiet status-bar item, "Navigation off", which runs that command. It hides once the window is trusted.
- The setup walkthrough has a step, Trust the review window, whose button runs the command, and which is done once the review window is trusted. The review window tells other windows whether it is trusted through `trust.json` in the extension's storage.
- The warning on every start of an untrusted review window is gone. This amends ADR 0010.

### Consequences

- Good, because one click trusts the review window and every Change it opens later, with no path to paste and no file dialog.
- Good, because the choice stays findable after the Reviewer closes the editor's prompt: in the status bar, the walkthrough and the command palette.
- Good, because a multi-root window of the Reviewer's own that opens Changes stops asking about untrusted folders once the review window is trusted.
- Bad, because the editor's prompt doesn't say what Dear Reviewer's Changes are; the walkthrough step and the hint's tooltip do.
- Bad, because a review window from an earlier version restarts its extension host once, when its first folder changes to the folder of Changes.
- Bad, because a window other than the review window learns that it was trusted only once the review window has started trusted.
