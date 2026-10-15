// Runs instead of the tests when Dear Reviewer opens its review window during
// a test run: VSCodium starts that window with the same test entry point. It
// records what the Reviewer sees there, for the test in the first window to
// check, and then waits for the run to end.

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { changeFiles, changeFilesTreeChanged } from "./changeFiles";
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

export interface ReviewWindowReport {
  folders: { name: string; path: string }[];
  /** The active tab's label. */
  tab?: string;
  tabs: string[];
  files: { original?: string; modified?: string }[];
  /** The Changes Change Files lists, by label. */
  changeFiles: string[];
}

/**
 * Writes what the review window shows now, and again whenever its editors,
 * tabs, folders or Change Files change, and every half second, for as long
 * as the run goes on: its folders, the active tab, every tab, any diff's
 * files, and the Changes Change Files lists.
 */
export async function observeReviewWindow(): Promise<never> {
  const file = reviewWindowReportFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // One write at a time, so a slower, older report never lands last.
  let writing = Promise.resolve();
  const write = () => {
    writing = writing.then(async () => {
      const listed = await changeFiles().catch(() => []);
      const report: ReviewWindowReport = {
        folders: workspaceFolders(),
        tab: activeTabLabel(),
        tabs: vscode.window.tabGroups.all.flatMap((group) =>
          group.tabs.map((tab) => tab.label)
        ),
        files: multiDiffFiles(),
        changeFiles: listed.map((entry) => entry.label),
      };
      // Renamed into place, so the test never reads a half-written report.
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(report, null, 2));
      fs.renameSync(`${file}.tmp`, file);
    });
  };
  vscode.window.onDidChangeVisibleTextEditors(write);
  vscode.window.tabGroups.onDidChangeTabs(write);
  vscode.workspace.onDidChangeWorkspaceFolders(write);
  (await changeFilesTreeChanged())(write);
  // Also now and then, as the review window may change state without any of
  // those events, such as when a Change it already lists is opened again.
  setInterval(write, 500);
  await eventually(() => {
    const overview = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .some((tab) => tab.input instanceof vscode.TabInputWebview);
    if (!overview) throw new Error("no overview yet");
  }, 60_000).catch(() => undefined);
  write();
  return new Promise<never>(() => {});
}
