# Collapsing unchanged code, and showing moves, in a Change's diffs

Dear Reviewer adds no setting or default of its own for collapsing the unchanged code in a diff, for how many lines show around a change, or for showing moved blocks.

## Why this is out of scope

VS Code's diff editor already does all three, and a Change's diffs are VS Code diff editors (`vscode.diff`):

- `diffEditor.hideUnchangedRegions.enabled` collapses unchanged code. The diff's title bar has a button that toggles it.
- `diffEditor.hideUnchangedRegions.contextLineCount` sets how many lines stay visible around a change (default 3), and `revealLineCount` sets how many a click on a collapsed region reveals (default 20).
- `diffEditor.experimental.showMoves` draws a block that moved within a file as a move. It works only in the side-by-side layout.

The review window's workspace file sets none of these, so the Reviewer's user settings apply there. The title-bar button writes to the user settings, so a click lasts across Changes and windows.

Setting these values in the review window would make things worse. The built-in button writes to the first scope that sets the value. If the workspace file set it, the click would go there, and `ReviewWindow.setFolders` rewrites that file whenever the folders change, which would undo the click. A Dear Reviewer setting copied into the file would then need a listener to copy clicks back. That's a sync loop whose only gain is a different default in one window.

A move from one file to another is a different request. VS Code doesn't detect it, and nothing here rules it out.

## Prior requests

- #162: "Collapse unchanged code and show moved blocks in a Change's diffs, with settings for collapsing and for how many lines to reveal around a change"
