// Runs instead of the tests when Dear Reviewer opens its review window during
// a test run: VSCodium starts that window with the same test entry point. It
// records what the Reviewer sees there, for the test in the first window to
// check, and then waits for the run to end.

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  activeTabLabel,
  eventually,
  multiDiffFiles,
  workspaceFolders,
} from "./reviewer";

export function isReviewWindow(): boolean {
  const file = vscode.workspace.workspaceFile?.fsPath ?? "";
  return path.basename(path.dirname(file)) === "review-window";
}

export function reviewWindowReportFile(): string {
  return path.join(process.env.DEAR_REVIEWER_FIXTURES!, "review-window.json");
}

/**
 * Writes what the review window shows now, and again whenever its editors,
 * tabs or folders change: the multi-file diff opens its editors one at a
 * time, so an early report can hold only some of its files.
 */
export async function observeReviewWindow(): Promise<never> {
  const file = reviewWindowReportFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const write = () => {
    const report = {
      folders: workspaceFolders(),
      tab: activeTabLabel(),
      files: multiDiffFiles(),
    };
    // Renamed into place, so the test never reads a half-written report.
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(report, null, 2));
    fs.renameSync(`${file}.tmp`, file);
  };
  vscode.window.onDidChangeVisibleTextEditors(write);
  vscode.window.tabGroups.onDidChangeTabs(write);
  vscode.workspace.onDidChangeWorkspaceFolders(write);
  await eventually(() => {
    if (multiDiffFiles().length === 0) throw new Error("no diff yet");
  }, 60_000).catch(() => undefined);
  write();
  return new Promise<never>(() => {});
}
