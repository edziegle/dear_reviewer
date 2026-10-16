// Reads the Dashboard the way the Reviewer sees it: the state the extension
// sends its view and the state the view rendered. Clicks in it are the
// messages the webview would send. The view renders only while it's in
// sight, so `showDashboard` brings it there first. The review window, which
// tests can't run in, is stood in for with `actAsReviewWindow`; a test that
// does stops before it ends.

import * as vscode from "vscode";

export interface DashboardChange {
  id: string;
  title: string;
  byline: string;
  review?: { verdict: string; text: string };
  standing: string[];
  finish: string;
}

export interface DashboardPullRequest {
  id: string;
  title: string;
  name: string;
  author: string;
  /** The cached avatar, as a webview resource URI. */
  avatar?: string;
  waited?: string;
  size: { files: number; additions: number; deletions: number };
  checks?: string;
  notes: string[];
}

export interface DashboardBranch {
  id: string;
  name: string;
  repository: string;
  ahead: string;
  notes: string[];
}

export interface DashboardProblem {
  id: string;
  text: string;
  action?: string;
}

export interface DashboardState {
  facts: string;
  next?: {
    kind: "resume" | "finish" | "open";
    id: string;
    label: string;
    place: string;
  };
  inProgress: DashboardChange[];
  waiting?: DashboardPullRequest[];
  authored?: DashboardPullRequest[];
  reviewed?: DashboardPullRequest[];
  branches: DashboardBranch[];
  loading: boolean;
  setup?: { text: string; actions: { id: string; label: string }[] };
  problems: DashboardProblem[];
  branchProblems: DashboardProblem[];
}

export type DashboardClick =
  | { type: "next" }
  | { type: "openRange" }
  | { type: "resume" | "finish" | "open" | "fix"; id: string };

interface DashboardView {
  visible: boolean;
  sent: DashboardState;
  rendered?: DashboardState;
  receive(message: DashboardClick): void;
}

interface DashboardApi {
  dashboard: {
    views(): DashboardView[];
    askReviewWindow(id: string, action: "resume" | "finish"): void;
    openChanges(): unknown[];
  };
  reviewWindow: { actAs(acting: boolean): Promise<void> };
}

async function api(): Promise<DashboardApi> {
  const extension = vscode.extensions.getExtension<DashboardApi>(
    "edziegle.dear-reviewer"
  );
  if (!extension) throw new Error("Dear Reviewer is not installed");
  return await extension.activate();
}

/** Has this window act as the review window, or stop. */
export async function actAsReviewWindow(acting: boolean): Promise<void> {
  await (await api()).reviewWindow.actAs(acting);
}

/** Asks the review window to act on an open Change, as another window's Dashboard would. */
export async function askReviewWindow(
  id: string,
  action: "resume" | "finish"
): Promise<void> {
  (await api()).dashboard.askReviewWindow(id, action);
}

/**
 * Closes every open Change, in any window. The open Changes outlast a
 * session, so those an earlier suite left open would otherwise be in
 * progress here.
 */
export async function closeEveryChange(): Promise<void> {
  for (const request of (await api()).dashboard.openChanges())
    await vscode.commands.executeCommand("dearReviewer.closeChange", request);
}

async function dashboardView(): Promise<DashboardView> {
  return (await api()).dashboard.views()[0];
}

/** Whether the Dashboard is in sight in the side bar. */
export async function dashboardVisible(): Promise<boolean> {
  return (await dashboardView()).visible;
}

/** What the Dashboard last rendered; fails while it's out of sight or rendering. */
export async function renderedDashboard(): Promise<DashboardState> {
  const view = await dashboardView();
  if (!view.visible) throw new Error("The Dashboard isn't in sight");
  if (!view.rendered)
    throw new Error("The Dashboard hasn't rendered its latest state");
  return view.rendered;
}

export async function clickDashboard(click: DashboardClick): Promise<void> {
  (await dashboardView()).receive(click);
}

export function showDashboard(): Thenable<unknown> {
  return vscode.commands.executeCommand("dearReviewer.showDashboard");
}
