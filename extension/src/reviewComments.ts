// A Change's review threads on its diff, through VS Code's comments API. A
// thread sits on a line or range of either side: the base worktree's file is
// GitHub's LEFT side, the head worktree's file its RIGHT side. On a pull
// request, the Reviewer's Comments go into their pending review on GitHub
// and come back from it after a reload. Everyone's published threads show
// too, and the Reviewer replies to them and resolves them (see ADR 0014). On
// a local Change, the Comments are kept in the extension's storage until a
// Brief ends the Review (see ADR 0016). The Reviewer's own threads in the
// Review take follow-up Comments that wait for it too (see ADR 0024). A Finding the Reviewer converts
// becomes a draft Comment at its place, saved only when they save it (see
// ADR 0017). The Assistant learns the threads as they stand (see ADR 0023).

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { changeName, type Change } from "./changeWorkspace";
import { git } from "./git";
import {
  NotSignedInError,
  type DiffSide,
  type ReviewEvent,
  type ReviewThread,
  type ThreadPlace,
} from "./github/client";
import type { ThreadInChange } from "./assistant/threads";
import type { Avatars } from "./inbox";
import type { PendingReviewsBySource } from "./pendingReview";
import { hasFolder } from "./reviewWindow";
import { messageOf } from "./errors";

export type Verdict = "approve" | "requestChanges" | "comment";

const events: Record<Verdict, ReviewEvent> = {
  approve: "APPROVE",
  requestChanges: "REQUEST_CHANGES",
  comment: "COMMENT",
};

/** A Comment in the Review under way; its context value enables edit and delete. */
class PendingComment implements vscode.Comment {
  mode = vscode.CommentMode.Preview;
  readonly contextValue = "pending";
  readonly label = "Pending";
  savedBody: string;

  constructor(
    /** GitHub's node id for the Comment, or the local Comment's id. */
    readonly id: string,
    public body: string | vscode.MarkdownString,
    public author: vscode.CommentAuthorInformation,
    readonly thread: vscode.CommentThread
  ) {
    this.savedBody = textOf(body);
  }
}

/**
 * A Comment the Reviewer hasn't saved yet, pre-filled from a Finding. It
 * reaches the Review only when they save it; cancelling drops it.
 */
class DraftComment implements vscode.Comment {
  mode = vscode.CommentMode.Editing;
  readonly contextValue = "draft";
  readonly label = "Draft";

  constructor(
    readonly place: ThreadPlace,
    public body: string | vscode.MarkdownString,
    public author: vscode.CommentAuthorInformation,
    readonly thread: vscode.CommentThread
  ) {}
}

/** A published Comment, the Reviewer's or anyone's; GitHub's Markdown, rendered without HTML or commands. */
class PublishedComment implements vscode.Comment {
  readonly mode = vscode.CommentMode.Preview;
  readonly body: vscode.MarkdownString;

  constructor(
    /** GitHub's node id for the Comment. */
    readonly id: string,
    body: string,
    readonly author: vscode.CommentAuthorInformation,
    readonly timestamp: Date
  ) {
    this.body = new vscode.MarkdownString(body);
    this.body.isTrusted = false;
    this.body.supportHtml = false;
  }
}

/**
 * What GitHub, or the extension's storage, says about a thread shown in the
 * gutter, but its Comments, which the thread itself holds.
 */
type ThreadState = Omit<ReviewThread, "comments">;

interface Place {
  change: Change;
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
  private readonly states = new WeakMap<vscode.CommentThread, ThreadState>();
  private readonly loaded = new Set<string>();
  private loading: Promise<void> = Promise.resolve();
  private readonly hunks = new Map<string, Promise<Hunks>>();
  private viewerIcon?: vscode.Uri;
  private readonly changed = new vscode.EventEmitter<void>();
  /** Fires when the threads shown, or their Comments, change. */
  readonly onDidChange = this.changed.event;

  constructor(
    private readonly openChanges: () => Change[],
    private readonly pending: PendingReviewsBySource,
    private readonly avatars: Avatars
  ) {
    this.controller = vscode.comments.createCommentController(
      "dearReviewer.review",
      "Dear Reviewer"
    );
    // The prompt shows on a thread's collapsed reply box.
    this.controller.options = { prompt: "Reply", placeHolder: "Comment" };
    this.controller.commentingRangeProvider = {
      provideCommentingRanges: (document) => this.commentingRanges(document),
    };
  }

  dispose(): void {
    this.controller.dispose();
    this.changed.dispose();
  }

  /**
   * The Change's threads as they stand, with each Comment's saved text. A
   * draft isn't in the Review until it is saved, so isn't one of them.
   */
  threadsOf(change: Change): ThreadInChange[] {
    // Only the Reviewer's own Comments are pending; "You" would mean the Assistant.
    const reviewer = { login: this.pending.viewer?.login ?? "Reviewer" };
    return [...(this.shown.get(change.id) ?? [])].flatMap((thread) => {
      const state = this.states.get(thread);
      if (!state) return [];
      const { id: _id, pending: _pending, ...place } = state;
      const comments = thread.comments.flatMap((c) =>
        c instanceof PendingComment
          ? [{ author: reviewer, body: c.savedBody, pending: true }]
          : c instanceof PublishedComment
            ? [
                {
                  author: { login: c.author.name },
                  body: c.body.value,
                  pending: false,
                },
              ]
            : []
      );
      return [{ ...place, comments }];
    });
  }

  /** Every thread shown, for every Change. */
  threads(): vscode.CommentThread[] {
    return [...this.shown.values()].flatMap((threads) => [...threads]);
  }

  /**
   * Shows the review threads of each Change open in this window that aren't
   * shown yet. Those that can't be loaded, such as a pull request's before
   * sign-in, are tried again on the next call.
   */
  sync(): Promise<void> {
    this.loading = this.loading.then(async () => {
      for (const change of this.shownChanges()) {
        if (this.loaded.has(change.id)) continue;
        try {
          await this.load(change);
          this.loaded.add(change.id);
        } catch (err) {
          if (err instanceof NotSignedInError) continue;
          void vscode.window.showErrorMessage(
            `Couldn't load the review threads of ${changeName(change)}: ${messageOf(err)}`
          );
        }
      }
    });
    return this.loading;
  }

  /**
   * Stops showing a closed Change's threads. A pull request's pending
   * review stays on GitHub, and a local Change's Comments stay in storage.
   */
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
        "Comments go on the diff of a Change open in this window."
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
    let saved: { threadId: string; commentId: string };
    try {
      saved = await this.pending.addThread(place.change, where, text);
    } catch (err) {
      showSaveFailed(place.change, err);
      return;
    }
    thread.comments = [
      new PendingComment(saved.commentId, text, this.author(), thread),
    ];
    this.track(place.change.id, thread, {
      ...where,
      id: saved.threadId,
      pending: true,
      resolved: false,
      outdated: false,
    });
  }

  /**
   * Adds the text to the Review under way, from Add Review Comment: as a new
   * thread's first Comment, or as a follow-up Comment on one of the
   * Reviewer's pending threads (see ADR 0024).
   */
  addToReview(reply: vscode.CommentReply): Promise<void> {
    return this.states.has(reply.thread)
      ? this.reply(reply)
      : this.addComment(reply);
  }

  /**
   * Adds the text the Reviewer wrote in a thread's reply box: pending if a
   * Review is, or else published. A pending thread's reply is always pending.
   */
  async reply(reply: vscode.CommentReply): Promise<void> {
    const { thread, text } = reply;
    const state = this.states.get(thread);
    const place = this.placeOf(thread.uri);
    if (!state || !place) {
      void vscode.window.showErrorMessage(
        "Replies go on the review threads of a Change open in this window."
      );
      return;
    }
    let saved: { commentId: string; pending: boolean };
    try {
      saved = await this.pending.reply(place.change, state.id, text);
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Couldn't save the reply: ${messageOf(err)}`
      );
      return;
    }
    thread.comments = [
      ...thread.comments,
      saved.pending
        ? new PendingComment(saved.commentId, text, this.author(), thread)
        : new PublishedComment(
            saved.commentId,
            text,
            this.author(),
            new Date()
          ),
    ];
    this.changed.fire();
  }

  /** Resolves or unresolves a published thread on GitHub. */
  async setResolved(
    thread: vscode.CommentThread,
    resolved: boolean
  ): Promise<void> {
    const state = this.states.get(thread);
    const place = this.placeOf(thread.uri);
    if (!state || state.pending || !place) return;
    try {
      await this.pending.setResolved(place.change, state.id, resolved);
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Couldn't ${resolved ? "resolve" : "unresolve"} the thread: ${messageOf(err)}`
      );
      return;
    }
    this.style(thread, { ...state, resolved });
    this.changed.fire();
  }

  /**
   * Opens a draft Comment with this text at the place, on the side's file,
   * for the Reviewer to edit and save into the Review, or cancel.
   */
  draft(
    change: Change,
    place: ThreadPlace,
    body: string
  ): vscode.CommentThread {
    const dir = place.side === "LEFT" ? change.baseDir : change.headDir;
    const first = place.startLine ?? place.line;
    const thread = this.controller.createCommentThread(
      vscode.Uri.file(path.join(dir, ...place.path.split("/"))),
      new vscode.Range(first - 1, 0, place.line - 1, 0),
      []
    );
    thread.comments = [new DraftComment(place, body, this.author(), thread)];
    thread.canReply = false;
    thread.contextValue = "draft";
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    let threads = this.shown.get(change.id);
    if (!threads) this.shown.set(change.id, (threads = new Set()));
    threads.add(thread);
    return thread;
  }

  /** Whether the lines are on their side's diff, the only lines that take Comments. */
  async onDiff(change: Change, place: ThreadPlace): Promise<boolean> {
    let hunks: Hunks;
    try {
      hunks = await this.hunksOf(change, place.path);
    } catch {
      return false;
    }
    const first = place.startLine ?? place.line;
    return hunks[place.side].some(
      ([start, end]) => start <= first && place.line <= end
    );
  }

  editComment(comment: vscode.Comment): void {
    if (!(comment instanceof PendingComment)) return;
    comment.mode = vscode.CommentMode.Editing;
    refresh(comment.thread);
  }

  async saveComment(comment: vscode.Comment): Promise<void> {
    if (comment instanceof DraftComment) return this.saveDraft(comment);
    if (!(comment instanceof PendingComment)) return;
    const place = this.placeOf(comment.thread.uri);
    if (!place) return;
    const text = textOf(comment.body);
    try {
      await this.pending.editComment(place.change, comment.id, text);
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Couldn't save the Comment: ${messageOf(err)}`
      );
      return;
    }
    comment.savedBody = text;
    comment.mode = vscode.CommentMode.Preview;
    refresh(comment.thread);
    this.changed.fire();
  }

  cancelEdit(comment: vscode.Comment): void {
    if (comment instanceof DraftComment) return this.drop(comment.thread);
    if (!(comment instanceof PendingComment)) return;
    comment.body = comment.savedBody;
    comment.mode = vscode.CommentMode.Preview;
    refresh(comment.thread);
  }

  async deleteComment(comment: vscode.Comment): Promise<void> {
    if (!(comment instanceof PendingComment)) return;
    const place = this.placeOf(comment.thread.uri);
    if (!place) return;
    try {
      await this.pending.deleteComment(place.change, comment.id);
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Couldn't delete the Comment: ${messageOf(err)}`
      );
      return;
    }
    const thread = comment.thread;
    thread.comments = thread.comments.filter((c) => c !== comment);
    if (thread.comments.length === 0) this.drop(thread);
    this.changed.fire();
  }

  /** Saves a draft Comment into the Review under way, as the first Comment of its thread. */
  private async saveDraft(comment: DraftComment): Promise<void> {
    const { thread } = comment;
    const place = this.placeOf(thread.uri);
    if (!place) return;
    const text = textOf(comment.body);
    let saved: { threadId: string; commentId: string };
    try {
      saved = await this.pending.addThread(place.change, comment.place, text);
    } catch (err) {
      showSaveFailed(place.change, err);
      return;
    }
    thread.comments = [
      new PendingComment(saved.commentId, text, this.author(), thread),
    ];
    this.track(place.change.id, thread, {
      ...comment.place,
      id: saved.threadId,
      pending: true,
      resolved: false,
      outdated: false,
    });
  }

  private drop(thread: vscode.CommentThread): void {
    for (const threads of this.shown.values()) threads.delete(thread);
    thread.dispose();
    this.changed.fire();
  }

  /**
   * Submits the pending review with the verdict and summary. That ends the
   * Review: its Comments are published, and stay in the gutter as such, and
   * GitHub records the head commit it covered (see ADR 0015). Gives the
   * submitted review's page on GitHub, or undefined if it wasn't submitted.
   */
  async submit(
    change: Change,
    verdict: Verdict,
    summary: string
  ): Promise<{ url?: string } | undefined> {
    const pullRequest = change.pullRequest;
    if (!pullRequest) return;
    let submitted: { url?: string };
    try {
      submitted = await this.pending.submit(change, events[verdict], summary);
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Couldn't submit your Review of ${pullRequest.repository} #${pullRequest.number}: ${messageOf(err)}`
      );
      return;
    }
    await this.reload(change);
    return submitted;
  }

  /** How many of the Change's Comments are in the Review under way, as last loaded. */
  pendingCount(change: Change): number {
    let count = 0;
    for (const thread of this.shown.get(change.id) ?? [])
      for (const comment of thread.comments)
        if (comment instanceof PendingComment) count++;
    return count;
  }

  /**
   * Drops the Review under way with its Comments, unpublished. Gives whether
   * it was dropped.
   */
  async discard(change: Change): Promise<boolean> {
    try {
      await this.pending.discard(change);
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Couldn't discard your Review of ${changeName(change)}: ${messageOf(err)}`
      );
      return false;
    }
    await this.reload(change);
    return true;
  }

  /** Shows the Change's threads afresh, such as after its Review ended. */
  async reload(change: Change): Promise<void> {
    this.clear(change.id);
    this.loaded.delete(change.id);
    await this.sync();
  }

  private async load(change: Change): Promise<void> {
    const threads = await this.pending.threads(change);
    const icons = await this.icons(threads);
    this.viewerIcon = icons.get(this.pending.viewer?.avatarUrl ?? "");
    const places = await Promise.all(
      threads.map((thread) => placeOfThread(change, thread))
    );
    this.clear(change.id);
    threads.forEach((thread, i) => this.show(change, thread, places[i], icons));
  }

  /** The avatars of the Reviewer and everyone who wrote in the threads, by URL. */
  private async icons(
    threads: ReviewThread[]
  ): Promise<Map<string, vscode.Uri | undefined>> {
    const urls = new Set(
      threads.flatMap((t) => t.comments.map((c) => c.author.avatarUrl))
    );
    if (this.pending.viewer) urls.add(this.pending.viewer.avatarUrl);
    return new Map(
      await Promise.all(
        [...urls].map(
          async (url) => [url, await this.avatars.file(url)] as const
        )
      )
    );
  }

  private show(
    change: Change,
    found: ReviewThread,
    place: { file: string; range: vscode.Range },
    icons: Map<string, vscode.Uri | undefined>
  ): void {
    const thread = this.controller.createCommentThread(
      vscode.Uri.file(place.file),
      place.range,
      []
    );
    thread.comments = found.comments.map((c) => {
      const author = {
        name: c.author.login,
        iconPath: icons.get(c.author.avatarUrl),
      };
      return c.pending
        ? new PendingComment(c.id, c.body, author, thread)
        : new PublishedComment(c.id, c.body, author, new Date(c.createdAt));
    });
    const { comments: _, ...state } = found;
    this.track(change.id, thread, state);
  }

  private track(
    changeId: string,
    thread: vscode.CommentThread,
    state: ThreadState
  ): void {
    this.style(thread, state);
    let threads = this.shown.get(changeId);
    if (!threads) this.shown.set(changeId, (threads = new Set()));
    threads.add(thread);
    this.changed.fire();
  }

  /**
   * Every thread takes replies: a pending thread's join the Review under
   * way as follow-up Comments (see ADR 0024). A published thread offers
   * Resolve or Unresolve; it starts collapsed once resolved or outdated, as
   * on github.com.
   */
  private style(thread: vscode.CommentThread, state: ThreadState): void {
    this.states.set(thread, state);
    thread.label = state.outdated ? "Outdated" : undefined;
    thread.canReply = true;
    if (state.pending) {
      thread.contextValue = "pending";
      thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
      return;
    }
    thread.contextValue = state.resolved ? "resolved" : "unresolved";
    thread.state = state.resolved
      ? vscode.CommentThreadState.Resolved
      : vscode.CommentThreadState.Unresolved;
    thread.collapsibleState =
      state.resolved || state.outdated
        ? vscode.CommentThreadCollapsibleState.Collapsed
        : vscode.CommentThreadCollapsibleState.Expanded;
  }

  private clear(changeId: string): void {
    for (const thread of this.shown.get(changeId) ?? []) thread.dispose();
    this.shown.delete(changeId);
    this.changed.fire();
  }

  private author(): vscode.CommentAuthorInformation {
    return {
      name: this.pending.viewer?.login ?? "You",
      iconPath: this.viewerIcon,
    };
  }

  /**
   * The lines of the diff on the document's side: GitHub only takes
   * Comments there, and a local Change offers the same.
   */
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

  /** Which Change, side and file the URI is, if it is in one. */
  private placeOf(uri: vscode.Uri): Place | undefined {
    if (uri.scheme !== "file") return;
    for (const change of this.shownChanges()) {
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

  private shownChanges(): Change[] {
    return this.openChanges().filter(
      (change) => hasFolder(change.baseDir) && hasFolder(change.headDir)
    );
  }
}

/**
 * Where a thread shows: its side's file, at its lines. An outdated thread's
 * lines are where it was written, so they stop at the end of the file, and
 * when its side no longer has the file, it shows on the other side's.
 */
async function placeOfThread(
  change: Change,
  thread: ReviewThread
): Promise<{ file: string; range: vscode.Range }> {
  const sides =
    thread.side === "LEFT"
      ? [change.baseDir, change.headDir]
      : [change.headDir, change.baseDir];
  const [own, other] = sides.map((dir) =>
    path.join(dir, ...thread.path.split("/"))
  );
  const first = thread.startLine ?? thread.line;
  if (!thread.outdated)
    return {
      file: own,
      range: new vscode.Range(first - 1, 0, thread.line - 1, 0),
    };
  const file = fs.existsSync(own) || !fs.existsSync(other) ? own : other;
  const last = Math.max(1, Math.min(thread.line, await lineCount(file)));
  return {
    file,
    range: new vscode.Range(Math.min(first, last) - 1, 0, last - 1, 0),
  };
}

async function lineCount(file: string): Promise<number> {
  let text: string;
  try {
    text = await fs.promises.readFile(file, "utf8");
  } catch {
    return 0;
  }
  if (text === "") return 0;
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
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

function showSaveFailed(change: Change, err: unknown): void {
  void vscode.window.showErrorMessage(
    change.pullRequest
      ? `Couldn't save the Comment to your pending review: ${messageOf(err)}`
      : `Couldn't save the Comment: ${messageOf(err)}`
  );
}

function refresh(thread: vscode.CommentThread): void {
  // The comments API redraws a thread when its comments are assigned.
  thread.comments = [...thread.comments];
}

function textOf(body: string | vscode.MarkdownString): string {
  return typeof body === "string" ? body : body.value;
}
