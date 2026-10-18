// Runs instead of the tests when Dear Reviewer opens its review window during
// a test run: VSCodium starts that window with the same test entry point. It
// records what the Reviewer sees there, for the test in the first window to
// check, and then waits for the run to end. It keeps the window open when Dear
// Reviewer closes it, since VSCodium ends the whole run once a window running
// the tests' entry point closes.

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { changeFiles, changeFilesTreeChanged } from "./changeFiles";
import {
  activeTabLabel,
  eventually,
  heldState,
  multiDiffFiles,
  shownChanges,
  workspaceFolders,
  type HeldState,
} from "./reviewer";

export function isReviewWindow(): boolean {
  const file = vscode.workspace.workspaceFile?.fsPath ?? "";
  return path.basename(path.dirname(file)) === "review-window";
}

/**
 * Where the window under test and the review window it opens meet. The review
 * window gets the launch's environment, not the phase's, so this is a folder
 * of the launch's fixtures root, which only the singleFolder suite uses.
 */
function meetingFolder(): string {
  return path.join(process.env.DEAR_REVIEWER_FIXTURES_ROOT!, "singleFolder");
}

/** How many times Dear Reviewer has closed this window, the review window. */
let closed = 0;

/**
 * Has Dear Reviewer count the times it closes the review window instead of
 * closing it: VSCodium exits, ending the run, once a window running the tests'
 * entry point closes.
 */
export async function keepReviewWindowOpen(): Promise<void> {
  const extension = vscode.extensions.getExtension<{
    reviewWindow: { closeWith(close?: () => void): void };
  }>("edziegle.dear-reviewer");
  if (!extension) throw new Error("Dear Reviewer is not installed");
  (await extension.activate()).reviewWindow.closeWith(() => closed++);
}

export function reviewWindowReportFile(): string {
  return path.join(meetingFolder(), "review-window.json");
}

function commandsFile(): string {
  return path.join(meetingFolder(), "review-window-commands.json");
}

interface CommandForReviewWindow {
  id: string;
  command: string;
  args: unknown[];
}

/** The commands asked of the review window so far, none if no file yet. */
function askedCommands(): CommandForReviewWindow[] {
  try {
    return JSON.parse(fs.readFileSync(commandsFile(), "utf8"));
  } catch {
    return [];
  }
}

/** Waits for the review window to show what `check` asks of its report. */
export async function inReviewWindow(
  check: (report: ReviewWindowReport) => void,
  timeoutMs = 30_000
): Promise<void> {
  await eventually(() => {
    check(
      JSON.parse(
        fs.readFileSync(reviewWindowReportFile(), "utf8")
      ) as ReviewWindowReport
    );
  }, timeoutMs);
}

/**
 * Has the review window run a command, as the Reviewer would there, such as
 * Find Issues on a Change open in it. Resolves once the command has run.
 */
export async function runInReviewWindow(
  command: string,
  ...args: unknown[]
): Promise<void> {
  const id = `${process.pid}-${Date.now()}-${Math.random()}`;
  const file = commandsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    `${file}.tmp`,
    JSON.stringify([...askedCommands(), { id, command, args }])
  );
  fs.renameSync(`${file}.tmp`, file);
  await inReviewWindow((report) => {
    if (!report.ran.includes(id)) throw new Error("not run yet");
  }, 60_000);
}

export interface ReviewWindowReport {
  folders: { name: string; path: string }[];
  /** The active tab's label. */
  tab?: string;
  tabs: string[];
  files: { original?: string; modified?: string }[];
  /** The Changes Change Files lists, by label. */
  changeFiles: string[];
  /** Every Change shown the way a review starts, oldest first, by name. */
  shown: readonly string[];
  /** What the window holds for Changes. */
  held: HeldState;
  /** The commands asked of it with `runInReviewWindow` that have run, by id. */
  ran: string[];
  /** How many times Dear Reviewer has closed it, which it keeps open. */
  closed: number;
}

/**
 * Writes what the review window shows now, and again whenever its editors,
 * tabs, folders or Change Files change, and every half second, for as long
 * as the run's fixtures last: its folders, the active tab, every tab, any
 * diff's files, the Changes Change Files lists, every Change shown, and
 * how many times it was closed.
 */
export async function observeReviewWindow(): Promise<never> {
  const file = reviewWindowReportFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // One write at a time, so a slower, older report never lands last.
  let writing = Promise.resolve();
  const ran: string[] = [];
  const started = new Set<string>();
  const runAsked = () => {
    for (const { id, command, args } of askedCommands()) {
      if (started.has(id)) continue;
      started.add(id);
      void Promise.resolve(vscode.commands.executeCommand(command, ...args))
        .catch(() => undefined)
        .then(() => {
          ran.push(id);
          write();
        });
    }
  };
  const write = () => {
    writing = writing
      .then(async () => {
        // The run is over once its fixtures are gone.
        if (!fs.existsSync(path.dirname(file))) {
          clearInterval(polling);
          return;
        }
        runAsked();
        const listed = await changeFiles().catch(() => []);
        const report: ReviewWindowReport = {
          folders: workspaceFolders(),
          tab: activeTabLabel(),
          tabs: vscode.window.tabGroups.all.flatMap((group) =>
            group.tabs.map((tab) => tab.label)
          ),
          files: multiDiffFiles(),
          changeFiles: listed.map((entry) => entry.label),
          shown: await shownChanges(),
          held: await heldState(),
          ran: [...ran],
          closed,
        };
        // Renamed into place, so the test never reads a half-written report.
        fs.writeFileSync(`${file}.tmp`, JSON.stringify(report, null, 2));
        fs.renameSync(`${file}.tmp`, file);
      })
      // One failed write leaves the next ones to try again.
      .catch(() => undefined);
  };
  vscode.window.onDidChangeVisibleTextEditors(write);
  vscode.window.tabGroups.onDidChangeTabs(write);
  vscode.workspace.onDidChangeWorkspaceFolders(write);
  (await changeFilesTreeChanged())(write);
  // Also now and then, as the review window may change state without any of
  // those events, such as when a Change it already lists is opened again.
  const polling = setInterval(write, 500);
  await eventually(() => {
    const overview = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .some((tab) => tab.input instanceof vscode.TabInputWebview);
    if (!overview) throw new Error("no overview yet");
  }, 60_000).catch(() => undefined);
  write();
  return new Promise<never>(() => {});
}
