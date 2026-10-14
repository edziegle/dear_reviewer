// Reads a pull request's timeline panel the way the Reviewer sees it: the
// state the extension sends it and the state it rendered. Clicks in the
// panel are the messages the webview would send.

import * as fs from "fs";
import * as vscode from "vscode";
import type { ChangeRequest } from "./reviewer";

export interface TimelineAuthor {
  login: string;
  /** The cached avatar, as a webview resource URI. */
  avatar?: string;
}

export type TimelineItem =
  | { kind: "description"; author: TimelineAuthor; date: string; body: string }
  | {
      kind: "commit";
      author: TimelineAuthor;
      date: string;
      sha: string;
      headline: string;
    }
  | { kind: "comment"; author: TimelineAuthor; date: string; body: string }
  | {
      kind: "review";
      author: TimelineAuthor;
      date: string;
      verdict: "approved" | "changesRequested" | "commented" | "dismissed";
      body: string;
      /** How many Comments on the diff the review holds. */
      comments: number;
    };

export interface Timeline {
  title: string;
  /** owner/name #number */
  pullRequest: string;
  url?: string;
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
  openLinksWith(open?: (url: string) => void): void;
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
  if (!found) throw new Error(`no timeline panel "${title}"`);
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

/** Clicks the button that goes with the problem the timeline shows. */
export async function clickProblemAction(title: string): Promise<void> {
  (await panel(title)).receive({ type: "problemAction" });
}

/**
 * Catches the links Dear Reviewer opens instead of handing them to the
 * browser, until `releaseLinks`.
 */
export async function catchLinks(): Promise<string[]> {
  const opened: string[] = [];
  (await timelineApi()).openLinksWith((url) => opened.push(url));
  return opened;
}

export async function releaseLinks(): Promise<void> {
  (await timelineApi()).openLinksWith(undefined);
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
