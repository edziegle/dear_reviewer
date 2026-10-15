// Turns the Reviewer's selection in an editor, or the lines on screen, into
// chat context: which open Change, which side's worktree, or the reviewed
// commit of what changed since the last Review, which file and which lines.
// Tells where the Reviewer is reading in the same terms: the lines on screen
// of the editor they used last.

import * as path from "path";
import * as vscode from "vscode";
import type { Change } from "../changeWorkspace";
import { commitFileScheme, parseCommitFileUri } from "../reviews";
import type { Selection } from "./prompts";

export function selectionInChange(
  editor: vscode.TextEditor,
  changes: Change[]
): { change: Change; selection: Selection & { text: string } } | undefined {
  const { start, end } = editor.selection;
  // A selection that ends at the start of a line doesn't take that line.
  const lastLine =
    end.line > start.line && end.character === 0 ? end.line - 1 : end.line;
  return linesInChange(editor, changes, start.line, lastLine);
}

/**
 * The selection in a file of a Change, as `selectionInChange` gives it, or
 * without one, the lines on screen, so the Reviewer can ask about them.
 */
export function selectionOrScreenInChange(
  editor: vscode.TextEditor,
  changes: Change[]
): ReturnType<typeof selectionInChange> {
  const onScreen = linesOnScreen(editor);
  if (!editor.selection.isEmpty || !onScreen)
    return selectionInChange(editor, changes);
  return linesInChange(editor, changes, onScreen.first, onScreen.last);
}

/** The first and last lines on screen in an editor, counted from 0. */
function linesOnScreen(
  editor: vscode.TextEditor
): { first: number; last: number } | undefined {
  const ranges = editor.visibleRanges;
  if (ranges.length === 0) return;
  return {
    first: ranges[0].start.line,
    last: ranges[ranges.length - 1].end.line,
  };
}

function linesInChange(
  editor: vscode.TextEditor,
  changes: Change[],
  firstLine: number,
  lastLine: number
): ReturnType<typeof selectionInChange> {
  const where = whereInChange(editor.document.uri, changes);
  if (!where) return;
  const lines = new vscode.Range(
    firstLine,
    0,
    lastLine,
    editor.document.lineAt(lastLine).range.end.character
  );
  return {
    change: where.change,
    selection: {
      ...where.file,
      startLine: firstLine + 1,
      endLine: lastLine + 1,
      text: editor.document.getText(lines),
    },
  };
}

/**
 * The file of a Change the Reviewer last had in front of them, with the
 * lines on screen, if it is still on screen. Focusing a panel, such as the
 * Assistant's, leaves the editor they used last on screen.
 */
export class ReadingTracker implements vscode.Disposable {
  private last = vscode.window.activeTextEditor;
  private readonly subscription = vscode.window.onDidChangeActiveTextEditor(
    (editor) => {
      if (editor) this.last = editor;
    }
  );

  constructor(private readonly changes: () => Change[]) {}

  readingIn(change: Change): Selection | undefined {
    const editor = vscode.window.activeTextEditor ?? this.last;
    if (!editor || !vscode.window.visibleTextEditors.includes(editor)) return;
    const where = whereInChange(editor.document.uri, this.changes());
    const onScreen = linesOnScreen(editor);
    if (where?.change.id !== change.id || !onScreen) return;
    return {
      ...where.file,
      startLine: onScreen.first + 1,
      endLine: onScreen.last + 1,
    };
  }

  dispose(): void {
    this.subscription.dispose();
  }
}

/**
 * The open Change a document belongs to, and where in it: a file in one of
 * its worktrees, or a file at the reviewed commit in what changed since its
 * last Review. Nothing else counts.
 */
export function whereInChange(
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
