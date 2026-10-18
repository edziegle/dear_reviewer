# Open Changes in a review window

Amended by [ADR 0040](0040-one-active-change-in-the-review-window.md): the review window holds one Change, the Active Change, so it is no longer where more than one Change is reviewed at once; only the review window holds Changes.

Opening a Change adds its base and head worktrees to the window as workspace folders. VS Code restarts the extension host when a single-folder or empty window gains folders, and when the first folder of a multi-root workspace changes, which would lose Dear Reviewer's state partway through opening the Change. Change folders are only ever added after the existing folders of a multi-root workspace. From any other window, the Change opens in the review window: a saved workspace that Dear Reviewer manages, whose first folder is a fixed "Dear Reviewer" home folder that is never removed.

## Considered Options

- **Add the folders to the current window and accept the restart**: rejected. Opening a Change would reload every extension in the window and drop whatever Dear Reviewer was doing.
- **Open each Change in its own window**: rejected. Reviewing more than one Change at once would mean juggling windows, and each window indexes its folders separately.

## Consequences

- Reviews typically happen in a separate Dear Reviewer window, not the window the Reviewer was working in.
- Code that edits workspace folders must never touch the first folder.
