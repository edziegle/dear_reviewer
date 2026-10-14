---
status: accepted
date: 2026-10-14
---

# Ask once whether to trust the review window's folder, and leave a quiet hint

## Context and Problem Statement

ADR 0010 had Dear Reviewer explain Restricted Mode and offer Manage Workspace Trust whenever the review window started untrusted. That warning came back on every start, with no way to dismiss it for good (#20). Trusting the folder is a real trade-off: the reviewed code's workspace settings and tasks then apply in the review window, including for pull requests from strangers. It should be the Reviewer's choice, asked once. How does Dear Reviewer ask, remember the answer, and keep the choice findable?

## Considered Options

- Ask once when a Change first opens, remember the answer in a file in the extension's storage, and show a status-bar hint in an untrusted review window, plus a walkthrough step
- The same, remembering the answer in `context.globalState`
- Keep the warning on every start

## Decision Outcome

Chosen option: ask once and remember it in a file, because a file is how Dear Reviewer keeps its other state (`open-changes.json`, `local-reviews.json`), every window reads it at once, and it survives restarts in the test runner, where `globalState` doesn't, so the tests can prove the question isn't asked again.

- The first time a Change opens, in whichever window opens it, Dear Reviewer says what trusting the folder turns on and what it lets the reviewed code do, with Trust… and Not now. Not now, or closing the message, is the answer for good. It doesn't ask when the review window is known to be trusted: the review window knows, and tells other windows through the same file.
- Trust… copies the storage folder's path, says to choose Add Folder and paste it, and opens Workspace Trust, as before. The command Trust the Review Window's Folder… runs the same flow.
- An untrusted review window shows a quiet status-bar item, "Navigation off", which runs that command. It hides once the window is trusted.
- The setup walkthrough has a step, Trust the review window's folder, whose button runs the command, and which is done once the review window is trusted.
- The warning on every start of an untrusted review window is gone. This amends ADR 0010.

### Consequences

- Good, because the Reviewer decides once and isn't asked again.
- Good, because the choice stays findable after Not now: in the status bar, the walkthrough and the command palette.
- Bad, because a Reviewer who dismissed the question by accident only sees the quiet hint afterwards.
- Bad, because a window other than the review window learns that the folder was trusted only once the review window has started trusted.
