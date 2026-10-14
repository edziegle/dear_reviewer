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
 * tabs or folders change, until the Change's overview has opened: its
 * folders, the active tab, every tab, and any diff's files.
 */
export async function observeReviewWindow(): Promise<never> {
  const file = reviewWindowReportFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const write = () => {
    const report = {
      folders: workspaceFolders(),
      tab: activeTabLabel(),
      tabs: vscode.window.tabGroups.all.flatMap((group) =>
        group.tabs.map((tab) => tab.label)
      ),
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
    const overview = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .some((tab) => tab.input instanceof vscode.TabInputWebview);
    if (!overview) throw new Error("no overview yet");
  }, 60_000).catch(() => undefined);
  write();
  return new Promise<never>(() => {});
}
