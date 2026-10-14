// Reads a Change's overview panel, with a pull request's timeline or a local
// Change's commits, the way the Reviewer sees it: the state the extension
// sends it and the state it rendered. Clicks in the panel are the messages
// the webview would send.

import * as fs from "fs";
import * as vscode from "vscode";
import type { ChangeRequest } from "./reviewer";

export { catchLinks, releaseLinks } from "./reviewer";

export interface TimelineAuthor {
  login: string;
  /** The cached avatar, as a webview resource URI. */
  avatar?: string;
}

export type TimelineItem =
  | {
      kind: "description";
      author: TimelineAuthor;
      date: string;
      body: string;
      /** The body's Markdown, rendered and sanitised. */
      html?: string;
    }
  | {
      kind: "commit";
      author: TimelineAuthor;
      date: string;
      sha: string;
      headline: string;
    }
  | {
      kind: "comment";
      author: TimelineAuthor;
      date: string;
      body: string;
      html?: string;
    }
  | {
      kind: "review";
      author: TimelineAuthor;
      date: string;
      verdict: "approved" | "changesRequested" | "commented" | "dismissed";
      body: string;
      html?: string;
      /** How many Comments on the diff the review holds. */
      comments: number;
    };

/** What the overview shows from the Change's Assistant. */
export interface Take {
  label: string;
  reading: boolean;
  text?: string;
  /** The text's Markdown, rendered and sanitised. */
  html?: string;
  problem?: string;
  problemAction?: string;
  canRetry?: boolean;
}

export interface Timeline {
  title: string;
  /** Such as `acme/api #7 · alice → main`. */
  byline: string;
  url?: string;
  size?: { files: number; additions: number; deletions: number };
  standing: string[];
  progress?: { viewed: number; total: number };
  navigationOff?: boolean;
  take: Take;
  finish: string;
  history: string;
  loading: boolean;
  items: TimelineItem[];
  checks?: {
    commit: string;
    status?: "passed" | "failed" | "running";
    runs: {
      name: string;
      status: "passed" | "failed" | "running" | "skipped" | "neutral";
      url?: string;
    }[];
  };
  problem?: string;
  /** The button that goes with the problem, by its label. */
  problemAction?: string;
}

interface TimelineApi {
  panels(): {
    title: string;
    sent: Timeline;
    rendered?: Timeline;
    receive(message: unknown): void;
  }[];
}

async function timelineApi(): Promise<TimelineApi> {
  const extension = vscode.extensions.getExtension<{ timeline: TimelineApi }>(
    "edziegle.dear-reviewer"
  );
  if (!extension) throw new Error("Dear Reviewer is not installed");
  return (await extension.activate()).timeline;
}

async function panel(title: string) {
  const found = (await timelineApi()).panels().find((p) => p.title === title);
  if (!found) throw new Error(`no overview panel "${title}"`);
  return found;
}

/** The state the extension last sent to the timeline panel with this title. */
export async function sentTimeline(title: string): Promise<Timeline> {
  return (await panel(title)).sent;
}

/** The state the panel last rendered, once it has rendered the latest one. */
export async function renderedTimeline(
  title: string
): Promise<Timeline | undefined> {
  return (await panel(title)).rendered;
}

/** Clicks a link in the panel. */
export async function clickLink(title: string, url: string): Promise<void> {
  (await panel(title)).receive({ type: "openLink", url });
}

/** Clicks the panel's refresh button. */
export async function clickRefresh(title: string): Promise<void> {
  (await panel(title)).receive({ type: "refresh" });
}

/** Clicks one of the overview's buttons. */
export async function clickOverview(
  title: string,
  button: "finish" | "nextFile" | "ask" | "takeAction" | "takeRetry" | "trust"
): Promise<void> {
  (await panel(title)).receive({ type: button });
}

/** Clicks a `path:line` reference in the Assistant's take. */
export async function clickTakeReference(
  title: string,
  reference: { path: string; startLine: number; endLine: number }
): Promise<void> {
  (await panel(title)).receive({ type: "openReference", ...reference });
}

/** What the overview with this title shows from the Assistant, as last sent. */
export async function overviewTake(
  title: string
): Promise<Omit<Take, "html"> | undefined> {
  const found = (await timelineApi()).panels().find((p) => p.title === title);
  if (!found) return;
  const {
    html: _html,
    fullHtml: _fullHtml,
    ...take
  } = found.sent.take as Take & { fullHtml?: string };
  return take;
}

/** Clicks the button that goes with the problem the timeline shows. */
export async function clickProblemAction(title: string): Promise<void> {
  (await panel(title)).receive({ type: "problemAction" });
}

export function showTimeline(change?: ChangeRequest): Thenable<unknown> {
  return vscode.commands.executeCommand("dearReviewer.showTimeline", change);
}

/** The bytes of the cached file a webview resource URI serves. */
export function avatarBytes(webviewUri: string): Buffer {
  const uri = new URL(webviewUri);
  if (!uri.hostname.includes("vscode-resource"))
    throw new Error(`${webviewUri} is not a webview resource`);
  return fs.readFileSync(decodeURIComponent(uri.pathname));
}
