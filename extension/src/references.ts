// Opens the code a message points at, such as `src/app.py:12` in an
// Assistant reply or the overview: a path in the Change's worktrees, at
// those lines, in the editor (ADR 0012).

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { Change } from "./changeWorkspace";

/**
 * Opens a file a reply points at, at those lines: a relative path in the
 * head worktree, an absolute one in either worktree, and nothing outside
 * them, even through a symbolic link.
 */
export async function openReference(
  change: Change,
  reference: string,
  startLine: number,
  endLine: number,
  /** Where it opens: the first column unless given. */
  viewColumn = vscode.ViewColumn.One
): Promise<void> {
  const file = path.resolve(change.headDir, reference);
  let real: string;
  try {
    real = fs.realpathSync(file);
    if (!fs.statSync(real).isFile()) return;
  } catch {
    return;
  }
  const worktrees = [change.headDir, change.baseDir].flatMap((dir) => {
    try {
      return [fs.realpathSync(dir)];
    } catch {
      return [];
    }
  });
  if (
    !worktrees.some((dir) => {
      const relative = path.relative(dir, real);
      return (
        relative && !relative.startsWith("..") && !path.isAbsolute(relative)
      );
    })
  )
    return;
  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.file(file)
  );
  const last = document.lineCount - 1;
  const start = Math.min(Math.max(startLine, 1) - 1, last);
  const end = Math.min(Math.max(endLine, startLine) - 1, last);
  const range = new vscode.Range(
    start,
    0,
    end,
    document.lineAt(end).range.end.character
  );
  await vscode.window.showTextDocument(document, {
    viewColumn,
    selection: range,
    preview: true,
  });
}
