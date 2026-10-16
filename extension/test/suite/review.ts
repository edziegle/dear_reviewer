// Comments on a pull request's diff, driven the way VS Code's comments UI
// drives them: a new thread comes from the controller, and the comment
// widget's buttons run the commands the extension contributes.

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { ChangeRequest } from "./reviewer";
import type { RecordedReview } from "./github";

interface ReviewApi {
  controller: vscode.CommentController;
  threads(): vscode.CommentThread[];
  inProgressFiles(): readonly string[];
}

async function reviewApi(): Promise<ReviewApi> {
  const extension = vscode.extensions.getExtension<{ review: ReviewApi }>(
    "edziegle.dear-reviewer"
  );
  if (!extension) throw new Error("Dear Reviewer is not installed");
  return (await extension.activate()).review;
}

/**
 * The files the `dearReviewer.reviewInProgressFiles` context key lists, as
 * `resourcePath` gives them: a new thread on them offers Add Review Comment,
 * and elsewhere Start Review.
 */
export async function reviewInProgressFiles(): Promise<readonly string[]> {
  return (await reviewApi()).inProgressFiles();
}

/** The lines, counted from 0, where the gutter offers to start a Comment. */
export async function commentingLines(
  file: string
): Promise<[number, number][]> {
  const { controller } = await reviewApi();
  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.file(file)
  );
  const provided =
    await controller.commentingRangeProvider?.provideCommentingRanges(
      document,
      new vscode.CancellationTokenSource().token
    );
  const ranges = Array.isArray(provided) ? provided : (provided?.ranges ?? []);
  return ranges.map((r) => [r.start.line, r.end.line]);
}

/**
 * Clicks the gutter's "+" on these lines (counted from 0) and writes the
 * Comment, as the comment widget does, giving back the thread it lands in.
 * The button pressed is Start Review or Add Review Comment, or the command
 * behind both.
 */
export async function comment(
  file: string,
  firstLine: number,
  lastLine: number,
  text: string,
  button: "addComment" | "startReview" | "addToReview" = "addComment"
): Promise<vscode.CommentThread> {
  const { controller } = await reviewApi();
  const thread = controller.createCommentThread(
    vscode.Uri.file(file),
    new vscode.Range(firstLine, 0, lastLine, 0),
    []
  );
  await vscode.commands.executeCommand(`dearReviewer.${button}`, {
    thread,
    text,
  });
  return thread;
}

/** Edits the Comment, typing new text and saving it. */
export async function editComment(
  target: vscode.Comment,
  text: string
): Promise<void> {
  await vscode.commands.executeCommand("dearReviewer.editComment", target);
  target.body = text;
  await vscode.commands.executeCommand("dearReviewer.saveComment", target);
}

/** Starts editing the Comment, types, then cancels. */
export async function cancelEdit(
  target: vscode.Comment,
  text: string
): Promise<void> {
  await vscode.commands.executeCommand("dearReviewer.editComment", target);
  target.body = text;
  await vscode.commands.executeCommand(
    "dearReviewer.cancelEditComment",
    target
  );
}

export function deleteComment(target: vscode.Comment): Thenable<unknown> {
  return vscode.commands.executeCommand("dearReviewer.deleteComment", target);
}

/** Replies to a thread, typing in its reply box and pressing Reply. */
export async function reply(
  thread: vscode.CommentThread,
  text: string
): Promise<void> {
  await vscode.commands.executeCommand("dearReviewer.replyToThread", {
    thread,
    text,
  });
}

/**
 * Adds a follow-up Comment to a thread in the Review under way, typing in
 * its reply box and pressing Add Review Comment.
 */
export async function addReviewComment(
  thread: vscode.CommentThread,
  text: string
): Promise<void> {
  await vscode.commands.executeCommand("dearReviewer.addToReview", {
    thread,
    text,
  });
}

export function resolveThread(thread: vscode.CommentThread): Thenable<unknown> {
  return vscode.commands.executeCommand("dearReviewer.resolveThread", thread);
}

export function unresolveThread(
  thread: vscode.CommentThread
): Thenable<unknown> {
  return vscode.commands.executeCommand("dearReviewer.unresolveThread", thread);
}

export type Verdict = "approve" | "requestChanges" | "comment";

export function submitReview(
  change: ChangeRequest,
  verdict: Verdict,
  summary: string
): Thenable<unknown> {
  return vscode.commands.executeCommand(
    "dearReviewer.submitReview",
    change,
    verdict,
    summary
  );
}

/** Runs Discard Pending Comments on the Change, confirming it. */
export function discardReview(change: ChangeRequest): Thenable<unknown> {
  return vscode.commands.executeCommand(
    "dearReviewer.discardReview",
    change,
    true
  );
}

/** Runs Show Changes Since Your Last Review on the Change. */
export function showChangesSinceLastReview(
  change: ChangeRequest
): Thenable<unknown> {
  return vscode.commands.executeCommand(
    "dearReviewer.showChangesSinceLastReview",
    change
  );
}

/** Runs Write Brief on the local Change, which opens a Brief to read before copying it. */
export function writeBrief(change: ChangeRequest): Thenable<unknown> {
  return vscode.commands.executeCommand("dearReviewer.writeBrief", change);
}

/** Clicks Copy Brief on the Brief's editor, the active one. */
export function copyBrief(): Thenable<unknown> {
  return vscode.commands.executeCommand("dearReviewer.copyBrief");
}

export interface ShownThread {
  file: string;
  /** First and last line, counted from 0. */
  lines: [number, number];
  comments: string[];
  /** Whether the thread's comments can still be edited, from their context value. */
  editable: boolean[];
}

/** The comment threads Dear Reviewer shows, sorted by file and line. */
export async function commentThreads(): Promise<ShownThread[]> {
  return (await reviewApi())
    .threads()
    .map((thread) => ({
      file: thread.uri.fsPath,
      lines: [thread.range?.start.line ?? -1, thread.range?.end.line ?? -1] as [
        number,
        number,
      ],
      comments: thread.comments.map((c) => bodyText(c)),
      editable: thread.comments.map((c) => c.contextValue === "pending"),
    }))
    .sort((a, b) => a.file.localeCompare(b.file) || a.lines[0] - b.lines[0]);
}

export interface ShownReviewThread {
  file: string;
  /** First and last line, counted from 0. */
  lines: [number, number];
  /** Each Comment's author, text and whether it is in the pending review. */
  comments: { author: string; body: string; pending: boolean }[];
  /** Such as "Outdated". */
  label?: string;
  resolved: boolean;
  canReply: boolean;
  /** Whether the thread offers Resolve, Unresolve or neither, from its context value. */
  offers?: "resolve" | "unresolve";
}

/** Every thread Dear Reviewer shows, with who wrote what, sorted by file and line. */
export async function reviewThreads(): Promise<ShownReviewThread[]> {
  return (await reviewApi())
    .threads()
    .map((thread) => ({
      file: thread.uri.fsPath,
      lines: [thread.range?.start.line ?? -1, thread.range?.end.line ?? -1] as [
        number,
        number,
      ],
      comments: thread.comments.map((c) => ({
        author: c.author.name,
        body: bodyText(c),
        pending: c.contextValue === "pending",
      })),
      ...(thread.label !== undefined && { label: thread.label }),
      resolved: thread.state === vscode.CommentThreadState.Resolved,
      canReply: thread.canReply !== false,
      ...(thread.contextValue === "unresolved" && {
        offers: "resolve" as const,
      }),
      ...(thread.contextValue === "resolved" && {
        offers: "unresolve" as const,
      }),
    }))
    .sort((a, b) => a.file.localeCompare(b.file) || a.lines[0] - b.lines[0]);
}

/** A thread as the Assistant reads it from its Change's threads file. */
export interface ThreadForAssistant {
  path: string;
  side: "base" | "head";
  lines: { start: number; end: number } | null;
  originalLines: { start: number; end: number };
  outdated: boolean;
  resolved: boolean;
  comments: { author: string; body: string; pending: boolean }[];
}

/** Where the Assistant reads the threads of the Change with this head worktree. */
export function threadsFileOf(headDir: string): string {
  return path.join(path.dirname(headDir), "assistant", "threads.json");
}

/**
 * The threads the Assistant reads for the Change with this head worktree,
 * sorted by path, side and line, or undefined before the file is written.
 */
export function threadsForAssistant(
  headDir: string
): ThreadForAssistant[] | undefined {
  let text: string;
  try {
    text = fs.readFileSync(threadsFileOf(headDir), "utf8");
  } catch {
    return;
  }
  return (JSON.parse(text) as ThreadForAssistant[]).sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      a.side.localeCompare(b.side) ||
      a.originalLines.start - b.originalLines.start
  );
}

/** The thread Dear Reviewer shows on this file, starting at this line. */
export async function threadAt(
  file: string,
  firstLine: number
): Promise<vscode.CommentThread> {
  const found = (await reviewApi())
    .threads()
    .find((t) => t.uri.fsPath === file && t.range?.start.line === firstLine);
  if (!found) throw new Error(`no thread at ${file}:${firstLine}`);
  return found;
}

export function bodyText(target: vscode.Comment): string {
  return typeof target.body === "string" ? target.body : target.body.value;
}

/** A review as the tests compare it: without the ids GitHub gave it. */
export function withoutIds(review: RecordedReview) {
  return {
    author: review.author,
    state: review.state,
    ...(review.body !== undefined && { body: review.body }),
    threads: review.threads
      .map((t) => ({
        path: t.path,
        side: t.side,
        ...(t.startLine !== undefined && { startLine: t.startLine }),
        line: t.line,
        comments: t.comments.map((c) => c.body),
      }))
      .sort(
        (a, b) =>
          a.path.localeCompare(b.path) ||
          a.side.localeCompare(b.side) ||
          a.line - b.line
      ),
  };
}
