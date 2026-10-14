// Turns the Reviewer's selection in an editor into chat context: which open
// Change, which side's worktree, which file and which lines.

import * as path from "path";
import * as vscode from "vscode";
import type { Change } from "../changeWorkspace";
import type { Selection } from "./prompts";

export function selectionInChange(
  editor: vscode.TextEditor,
  changes: Change[]
): { change: Change; selection: Selection & { text: string } } | undefined {
  const uri = editor.document.uri;
  if (uri.scheme !== "file") return;
  for (const change of changes) {
    for (const [side, dir] of [
      ["base", change.baseDir],
      ["head", change.headDir],
    ] as const) {
      const relative = path.relative(dir, uri.fsPath);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
        continue;
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
        change,
        selection: {
          path: relative.split(path.sep).join("/"),
          side,
          startLine: start.line + 1,
          endLine: lastLine + 1,
          text: editor.document.getText(lines),
        },
      };
    }
  }
}
