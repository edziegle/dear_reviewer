// Reads Home the way the Reviewer sees it: the state the extension sends its
// panel and the state the panel rendered. Clicks in it are the messages the
// webview would send. Home shows only in the review window, which tests
// can't run in, so a test stands in for it with `actAsReviewWindow` and
// stops before it ends.

import * as vscode from "vscode";

export interface HomeChange {
  id: string;
  title: string;
  byline: string;
  review?: { verdict: string; text: string };
  standing: string[];
  finish: string;
}

export interface HomePullRequest {
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

export interface HomeBranch {
  id: string;
  name: string;
  repository: string;
  ahead: string;
  notes: string[];
}

export interface HomeProblem {
  id: string;
  text: string;
  action?: string;
}

export interface HomeState {
  facts: string;
  next?: {
    kind: "resume" | "finish" | "open";
    id: string;
    label: string;
    place: string;
  };
  inProgress: HomeChange[];
  waiting?: HomePullRequest[];
  authored?: HomePullRequest[];
  branches: HomeBranch[];
  loading: boolean;
  setup?: HomeProblem;
  problems: HomeProblem[];
  branchProblems: HomeProblem[];
}

export type HomeClick =
  | { type: "refresh" }
  | { type: "next" }
  | { type: "resume" | "finish" | "open" | "fix"; id: string };

interface HomePanel {
  title: string;
  active: boolean;
  sent: HomeState;
  rendered?: HomeState;
  receive(message: HomeClick): void;
}

interface HomeApi {
  home: {
    panels(): HomePanel[];
    actAsReviewWindow(acting: boolean): Promise<void>;
  };
}

async function api(): Promise<HomeApi["home"]> {
  const extension = vscode.extensions.getExtension<HomeApi>(
    "edziegle.dear-reviewer"
  );
  if (!extension) throw new Error("Dear Reviewer is not installed");
  return (await extension.activate()).home;
}

/** Has this window act as the review window, for Home, or stop. */
export async function actAsReviewWindow(acting: boolean): Promise<void> {
  await (await api()).actAsReviewWindow(acting);
}

/** Home's panel, if it is open. */
export async function homePanel(): Promise<HomePanel | undefined> {
  return (await api()).panels()[0];
}

/** What Home's panel last rendered; fails while it is closed or rendering. */
export async function renderedHome(): Promise<HomeState> {
  const panel = await homePanel();
  if (!panel) throw new Error("Home is not open");
  if (!panel.rendered) throw new Error("Home hasn't rendered its latest state");
  return panel.rendered;
}

export async function clickHome(click: HomeClick): Promise<void> {
  const panel = await homePanel();
  if (!panel) throw new Error("Home is not open");
  panel.receive(click);
}

export function showHome(): Thenable<unknown> {
  return vscode.commands.executeCommand("dearReviewer.showHome");
}
