# Open Changes in a review window

Opening a Change adds its base and head worktrees to the window as workspace folders. VS Code restarts the extension host when a single-folder or empty window gains folders, and when the first folder of a multi-root workspace changes, which would lose Dear Reviewer's state partway through opening the Change. Change folders are therefore only ever added after the existing folders of a multi-root workspace. From any other window, the Change opens in the review window: a saved workspace that Dear Reviewer manages, whose first folder is a fixed "Dear Reviewer" home folder that is never removed.

## Considered Options

- **Add the folders to the current window and accept the restart**: rejected. Opening a Change would reload every extension in the window and drop whatever Dear Reviewer was doing.
- **Open each Change in its own window**: rejected. Reviewing several Changes at once would mean juggling windows, and each window indexes its folders separately.

## Consequences

- Reviews usually happen in a separate Dear Reviewer window, not the window the Reviewer was working in.
- Code that edits workspace folders must never touch the first folder.
