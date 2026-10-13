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

export async function observeReviewWindow(): Promise<never> {
  await eventually(() => {
    if (multiDiffFiles().length === 0) throw new Error("no diff yet");
  }, 60_000).catch(() => undefined);
  const report = {
    folders: workspaceFolders(),
    tab: activeTabLabel(),
    files: multiDiffFiles(),
  };
  fs.mkdirSync(path.dirname(reviewWindowReportFile()), { recursive: true });
  fs.writeFileSync(reviewWindowReportFile(), JSON.stringify(report, null, 2));
  return new Promise<never>(() => {});
}
