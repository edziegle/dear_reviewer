// Turns the Reviewer's selection in an editor into chat context: which open
// Change, which side's worktree, or the reviewed commit of what changed since
// the last Review, which file and which lines.

import * as path from "path";
import * as vscode from "vscode";
import type { Change } from "../changeWorkspace";
import { commitFileScheme, parseCommitFileUri } from "../reviews";
import type { Selection } from "./prompts";

export function selectionInChange(
  editor: vscode.TextEditor,
  changes: Change[]
): { change: Change; selection: Selection & { text: string } } | undefined {
  const where = whereInChange(editor.document.uri, changes);
  if (!where) return;
  const { start, end } = editor.selection;
  // A selection that ends at the start of a line doesn't take that line.
  const lastLine =
    end.line > start.line && end.character === 0 ? end.line - 1 : end.line;
  const lines = new vscode.Range(
    start.line,
    0,
    lastLine,
    editor.document.lineAt(lastLine).range.end.character
  );
  return {
    change: where.change,
    selection: {
      ...where.file,
      startLine: start.line + 1,
      endLine: lastLine + 1,
      text: editor.document.getText(lines),
    },
  };
}

/**
 * The open Change a document belongs to, and where in it: a file in one of
 * its worktrees, or a file at the reviewed commit in what changed since its
 * last Review. Nothing else counts.
 */
function whereInChange(
  uri: vscode.Uri,
  changes: Change[]
):
  | { change: Change; file: Pick<Selection, "path" | "side" | "commit"> }
  | undefined {
  if (uri.scheme === commitFileScheme) {
    const { commit, path: file, changeId } = parseCommitFileUri(uri);
    const change = changes.find((c) => c.id === changeId);
    if (change && commit && file)
      return { change, file: { path: file, side: "commit", commit } };
    return;
  }
  if (uri.scheme !== "file") return;
  for (const change of changes) {
    for (const [side, dir] of [
      ["base", change.baseDir],
      ["head", change.headDir],
    ] as const) {
      const relative = path.relative(dir, uri.fsPath);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
        continue;
      return {
        change,
        file: { path: relative.split(path.sep).join("/"), side },
      };
    }
  }
}
