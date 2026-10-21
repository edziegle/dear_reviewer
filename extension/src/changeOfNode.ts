// Which Change a Change Files element stands for. Kept apart from `vscode`
// so the unit tests can run it under plain Node.

import type { Change } from "./changeDetails";
import type { ChangeFilesNode } from "./changeFiles";

/**
 * The Change the element is in: its own for a Change row, and the one it
 * sits under for a folder, step or file, since a tree view's title-bar
 * button hands over whichever row has the focus. None for a problem row,
 * which isn't in any Change.
 */
export function changeOfNode(node: ChangeFilesNode): Change | undefined {
  return node.kind === "problem" ? undefined : node.change;
}
