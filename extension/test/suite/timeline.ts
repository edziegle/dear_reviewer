// Reads a Change's overview panel, with a pull request's timeline or a local
// Change's commits, the way the Reviewer sees it: the state the extension
// sends it and the state it rendered. Clicks in the panel are the messages
// the webview would send.

import * as fs from "fs";
import * as vscode from "vscode";
import type { Verdict } from "./review";
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

/** The Assistant's suggested order for reading the Change's files, as the overview lists it. */
export interface ShownReadingOrder {
  /** Whether the Assistant is writing it. */
  writing: boolean;
  /** Whether the Change has new commits since it was written. */
  outOfDate: boolean;
  /** Whether the Assistant's last try to write it gave nothing usable. */
  problem?: boolean;
  steps: {
    label: string;
    files: { path: string; why?: string; viewed: boolean }[];
  }[];
}

export interface Timeline {
  title: string;
  /** Such as `acme/api #7 · alice → main`. */
  byline: string;
  url?: string;
  size?: { files: number; additions: number; deletions: number };
  /** The Reviewer's last Review, while no new commits came since. */
  review?: {
    verdict: "approved" | "changesRequested" | "commented" | "briefed";
    text: string;
  };
  standing: string[];
  progress?: { viewed: number; total: number };
  /** Whether the last Review covers the head, with no Comments pending. */
  finished?: boolean;
  /** How many Comments are pending, once counted. */
  pending?: number;
  navigationOff?: boolean;
  /** File extensions, such as `.tofu`, that no installed language highlights, while offered. */
  unhighlighted?: string[];
  take: Take;
  readingOrder?: ShownReadingOrder;
  finish: string;
  /** The Submit step that ends a pull request's Review, while it is open. */
  submit?: {
    asked: number;
    verdicts: { verdict: Verdict; label: string; detail: string }[];
    verdict?: Verdict;
    /** Why GitHub would refuse each verdict that needs a summary, while there is none. */
    needsSummary: Partial<Record<Verdict, string>>;
    comments: { path: string; side: "LEFT" | "RIGHT"; line: number; text: string }[];
    submitting: boolean;
    problem?: string;
    problemAction?: string;
    /** Why some verdicts aren't offered. */
    note?: string;
  };
  /** The Review just submitted from the step. */
  submitted?: { text: string; url?: string };
  /** Where a local Change's Brief stands. */
  brief?: {
    phase: "writing" | "written" | "problem" | "ended";
    comments: number;
    problem?: string;
    canShow: boolean;
  };
  /** Goes up each time the Reviewer is brought here to finish. */
  finishAsked?: number;
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
    /** How many lead the list because they failed or are still running. */
    attention: number;
    /** Such as "1 failed · 2 running · 38 passed". */
    summary: string;
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
  const panels = (await timelineApi()).panels();
  const found = panels.find((p) => p.title === title);
  if (!found)
    throw new Error(
      `no overview panel "${title}" among ${JSON.stringify(panels.map((p) => p.title))}`
    );
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
  button:
    | "finish"
    | "nextFile"
    | "ask"
    | "takeAction"
    | "takeRetry"
    | "trust"
    | "suggestReadingOrder"
    | "closeChange"
    | "copyBrief"
    | "showBrief"
    | "discard"
): Promise<void> {
  (await panel(title)).receive({ type: button });
}

/** Picks the verdict, writes the summary and clicks Submit Review in the overview's Submit step. */
export async function submitInOverview(
  title: string,
  verdict: Verdict,
  summary: string
): Promise<void> {
  (await panel(title)).receive({ type: "submit", verdict, summary });
}

/** Clicks Cancel in the overview's Submit step. */
export async function cancelSubmit(title: string): Promise<void> {
  (await panel(title)).receive({ type: "cancelSubmit" });
}

/** Clicks a pending Comment in the overview's Submit step, by its place in the list. */
export async function clickPendingComment(
  title: string,
  index: number
): Promise<void> {
  (await panel(title)).receive({ type: "openPending", index });
}

/** Clicks Find an Extension for a file extension in the overview. */
export async function clickFindExtension(
  title: string,
  extension: string
): Promise<void> {
  (await panel(title)).receive({ type: "findExtension", extension });
}

/** Clicks Don't ask again on the overview's line about syntax highlighting. */
export async function clickDontAskAgain(title: string): Promise<void> {
  (await panel(title)).receive({ type: "dismissUnhighlighted" });
}

/** Clicks a `path:line` reference in the Assistant's take. */
export async function clickTakeReference(
  title: string,
  reference: { path: string; startLine: number; endLine: number }
): Promise<void> {
  (await panel(title)).receive({ type: "openReference", ...reference });
}

/** Clicks a file in the overview's Reading Order. */
export async function clickReadingOrderFile(
  title: string,
  file: string
): Promise<void> {
  (await panel(title)).receive({ type: "openFile", path: file });
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
