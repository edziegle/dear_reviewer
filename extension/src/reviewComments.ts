// The Reviewer's Comments on a pull request's diff, through VS Code's
// comments API. A Comment sits on a line or range of either side: the base
// worktree's file is GitHub's LEFT side, the head worktree's file its RIGHT
// side. Comments go into the Reviewer's pending review on GitHub, come back
// from it after a reload, and leave the gutter when the Review is submitted.

import * as path from "path";
import * as vscode from "vscode";
import type { Change } from "./changeWorkspace";
import { git } from "./git";
import {
  NotSignedInError,
  type DiffSide,
  type PendingThread,
  type ReviewEvent,
  type ThreadPlace,
} from "./github/client";
import type { PendingReviews } from "./pendingReview";
import { hasFolder } from "./reviewWindow";

export type Verdict = "approve" | "requestChanges" | "comment";

const events: Record<Verdict, ReviewEvent> = {
  approve: "APPROVE",
  requestChanges: "REQUEST_CHANGES",
  comment: "COMMENT",
};

/** A Comment in the pending review; its context value enables edit and delete. */
class PendingComment implements vscode.Comment {
  mode = vscode.CommentMode.Preview;
  readonly contextValue = "pending";
  readonly label = "Pending";
  savedBody: string;

  constructor(
    /** GitHub's node id for the Comment. */
    readonly id: string,
    public body: string | vscode.MarkdownString,
    public author: vscode.CommentAuthorInformation,
    readonly thread: vscode.CommentThread
  ) {
    this.savedBody = textOf(body);
  }
}

interface Place {
  change: Change & { pullRequest: NonNullable<Change["pullRequest"]> };
  side: DiffSide;
  /** Relative to the repository root, with forward slashes. */
  path: string;
}

/** Lines, counted from 1, of each side of a file's diff, as first and last line. */
interface Hunks {
  LEFT: [number, number][];
  RIGHT: [number, number][];
}

export class ReviewComments implements vscode.Disposable {
  readonly controller: vscode.CommentController;
  /** The threads shown for each Change, by Change id. */
  private readonly shown = new Map<string, Set<vscode.CommentThread>>();
  private readonly loaded = new Set<string>();
  private loading: Promise<void> = Promise.resolve();
  private readonly hunks = new Map<string, Promise<Hunks>>();

  constructor(
    private readonly openChanges: () => Change[],
    private readonly pending: PendingReviews
  ) {
    this.controller = vscode.comments.createCommentController(
      "dearReviewer.review",
      "Dear Reviewer"
    );
    this.controller.options = {
      prompt: "Add a Comment to your pending review",
      placeHolder: "Comment",
    };
    this.controller.commentingRangeProvider = {
      provideCommentingRanges: (document) => this.commentingRanges(document),
    };
  }

  dispose(): void {
    this.controller.dispose();
  }

  /** Every thread shown, for every Change. */
  threads(): vscode.CommentThread[] {
    return [...this.shown.values()].flatMap((threads) => [...threads]);
  }

  /**
   * Shows the pending review of each pull request Change open in this window
   * that isn't shown yet. One that can't be loaded, such as before sign-in,
   * is tried again on the next call.
   */
  sync(): Promise<void> {
    this.loading = this.loading.then(async () => {
      for (const change of this.pullRequestChanges()) {
        if (this.loaded.has(change.id)) continue;
        try {
          await this.load(change);
          this.loaded.add(change.id);
        } catch (err) {
          if (err instanceof NotSignedInError) continue;
          void vscode.window.showErrorMessage(
            `Couldn't load your pending review of ${change.pullRequest.repository} #${change.pullRequest.number}: ${messageOf(err)}`
          );
        }
      }
    });
    return this.loading;
  }

  /** Stops showing a closed Change's Comments; its pending review stays on GitHub. */
  forget(change: Change): void {
    this.clear(change.id);
    this.loaded.delete(change.id);
    for (const key of [...this.hunks.keys()])
      if (key.startsWith(`${change.id}\0`)) this.hunks.delete(key);
  }

  /** Saves the text the Reviewer wrote in a new thread as its first Comment. */
  async addComment(reply: vscode.CommentReply): Promise<void> {
    const { thread, text } = reply;
    const place = this.placeOf(thread.uri);
    const range = thread.range;
    if (!place || !range) {
      void vscode.window.showErrorMessage(
        "Comments go on the diff of a pull request's Change."
      );
      return;
    }
    const where: ThreadPlace = {
      path: place.path,
      side: place.side,
      line: range.end.line + 1,
      ...(range.end.line > range.start.line && {
        startLine: range.start.line + 1,
      }),
    };
    let saved: { commentId: string };
    try {
      saved = await this.pending.addThread(
        place.change.pullRequest,
        where,
        text
      );
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Couldn't save the Comment to your pending review: ${messageOf(err)}`
      );
      return;
    }
    thread.comments = [
      new PendingComment(saved.commentId, text, this.author(), thread),
    ];
    this.track(place.change.id, thread);
  }

  editComment(comment: vscode.Comment): void {
    if (!(comment instanceof PendingComment)) return;
    comment.mode = vscode.CommentMode.Editing;
    refresh(comment.thread);
  }

  async saveComment(comment: vscode.Comment): Promise<void> {
    if (!(comment instanceof PendingComment)) return;
    const text = textOf(comment.body);
    try {
      await this.pending.editComment(comment.id, text);
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Couldn't save the Comment: ${messageOf(err)}`
      );
      return;
    }
    comment.savedBody = text;
    comment.mode = vscode.CommentMode.Preview;
    refresh(comment.thread);
  }

  cancelEdit(comment: vscode.Comment): void {
    if (!(comment instanceof PendingComment)) return;
    comment.body = comment.savedBody;
    comment.mode = vscode.CommentMode.Preview;
    refresh(comment.thread);
  }

  async deleteComment(comment: vscode.Comment): Promise<void> {
    if (!(comment instanceof PendingComment)) return;
    try {
      await this.pending.deleteComment(comment.id);
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Couldn't delete the Comment: ${messageOf(err)}`
      );
      return;
    }
    const thread = comment.thread;
    thread.comments = thread.comments.filter((c) => c !== comment);
    if (thread.comments.length === 0) {
      for (const threads of this.shown.values()) threads.delete(thread);
      thread.dispose();
    }
  }

  /**
   * Submits the pending review with the verdict and summary. That ends the
   * Review: its Comments are published and leave the pending review.
   */
  async submit(
    change: Change,
    verdict: Verdict,
    summary: string
  ): Promise<boolean> {
    const pullRequest = change.pullRequest;
    if (!pullRequest) return false;
    try {
      await this.pending.submit(pullRequest, events[verdict], summary);
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Couldn't submit your Review of ${pullRequest.repository} #${pullRequest.number}: ${messageOf(err)}`
      );
      return false;
    }
    this.clear(change.id);
    return true;
  }

  private async load(change: Place["change"]): Promise<void> {
    const threads = await this.pending.threads(change.pullRequest);
    this.clear(change.id);
    for (const pending of threads) this.show(change, pending);
  }

  private show(change: Place["change"], pending: PendingThread): void {
    const dir = pending.side === "LEFT" ? change.baseDir : change.headDir;
    const thread = this.controller.createCommentThread(
      vscode.Uri.file(path.join(dir, ...pending.path.split("/"))),
      new vscode.Range(
        (pending.startLine ?? pending.line) - 1,
        0,
        pending.line - 1,
        0
      ),
      []
    );
    thread.comments = pending.comments.map(
      (c) => new PendingComment(c.id, c.body, this.author(), thread)
    );
    this.track(change.id, thread);
  }

  private track(changeId: string, thread: vscode.CommentThread): void {
    thread.canReply = false;
    thread.contextValue = "pending";
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    let threads = this.shown.get(changeId);
    if (!threads) this.shown.set(changeId, (threads = new Set()));
    threads.add(thread);
  }

  private clear(changeId: string): void {
    for (const thread of this.shown.get(changeId) ?? []) thread.dispose();
    this.shown.delete(changeId);
  }

  private author(): vscode.CommentAuthorInformation {
    return { name: this.pending.viewer ?? "You" };
  }

  /** The lines of the diff on the document's side: GitHub only takes Comments there. */
  private async commentingRanges(
    document: vscode.TextDocument
  ): Promise<vscode.Range[]> {
    const place = this.placeOf(document.uri);
    if (!place) return [];
    let hunks: Hunks;
    try {
      hunks = await this.hunksOf(place.change, place.path);
    } catch {
      return [];
    }
    return hunks[place.side].map(
      ([first, last]) => new vscode.Range(first - 1, 0, last - 1, 0)
    );
  }

  private hunksOf(change: Change, file: string): Promise<Hunks> {
    const key = `${change.id}\0${file}`;
    let hunks = this.hunks.get(key);
    if (!hunks) {
      hunks = diffHunks(change, file);
      hunks.catch(() => this.hunks.delete(key));
      this.hunks.set(key, hunks);
    }
    return hunks;
  }

  /** Which pull request Change, side and file the URI is, if it is in one. */
  private placeOf(uri: vscode.Uri): Place | undefined {
    if (uri.scheme !== "file") return;
    for (const change of this.pullRequestChanges()) {
      for (const [side, dir] of [
        ["LEFT", change.baseDir],
        ["RIGHT", change.headDir],
      ] as const) {
        const relative = path.relative(dir, uri.fsPath);
        if (
          relative &&
          !relative.startsWith("..") &&
          !path.isAbsolute(relative)
        )
          return { change, side, path: relative.split(path.sep).join("/") };
      }
    }
  }

  private pullRequestChanges(): Place["change"][] {
    return this.openChanges().filter(
      (change): change is Place["change"] =>
        change.pullRequest !== undefined &&
        hasFolder(change.baseDir) &&
        hasFolder(change.headDir)
    );
  }
}

/**
 * The lines of each side that the file's diff shows, with GitHub's three
 * lines of context; GitHub rejects Comments on other lines.
 */
async function diffHunks(change: Change, file: string): Promise<Hunks> {
  const diff = await git(
    change.repository,
    "--literal-pathspecs",
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--no-renames",
    "-U3",
    change.mergeBase,
    change.headSha,
    "--",
    file
  );
  const hunks: Hunks = { LEFT: [], RIGHT: [] };
  for (const [, oldStart, oldCount, newStart, newCount] of diff.matchAll(
    /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm
  )) {
    for (const [side, start, count] of [
      ["LEFT", Number(oldStart), Number(oldCount ?? 1)],
      ["RIGHT", Number(newStart), Number(newCount ?? 1)],
    ] as const) {
      if (count > 0) hunks[side].push([start, start + count - 1]);
    }
  }
  return hunks;
}

function refresh(thread: vscode.CommentThread): void {
  // The comments API redraws a thread when its comments are assigned.
  thread.comments = [...thread.comments];
}

function textOf(body: string | vscode.MarkdownString): string {
  return typeof body === "string" ? body : body.value;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
