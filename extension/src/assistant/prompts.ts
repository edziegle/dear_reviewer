// What Dear Reviewer tells the Assistant.

import * as path from "path";
import {
  Change,
  changedFiles,
  changeTitle,
  filesChangedBetween,
} from "../changeWorkspace";
import { git } from "../git";

/** The most diff text put in a prompt; the Assistant can read the rest itself. */
const maxDiffChars = 60_000;

export function assistantRole(change: Change): string {
  return [
    "You are the Assistant in Dear Reviewer, a workbench for a human Reviewer reviewing a Change.",
    "You help the Reviewer understand the Change: you summarise, answer questions and point at spots that deserve attention.",
    "You never review, approve or decide anything, and you never publish anything. You can only read files.",
    ...worktrees(change),
    "Give these absolute paths to your tools: your working directory holds no code.",
    "Reply in Markdown. When you point at code, write its path relative to the repository root with the line or lines, such as `src/app.py:12` or `src/app.py:12-30`, so the Reviewer can click it to open the head side; for the base side, give the absolute path in the base worktree.",
  ].join("\n");
}

function worktrees(change: Change): string[] {
  return [
    `The Change's head worktree, at commit ${change.headSha}, is ${change.headDir}.`,
    `The base worktree, at the merge base ${change.mergeBase}, is ${change.baseDir}. Compare the two to see what changed.`,
  ];
}

/** Lines of a file on one side of a Change, counted from 1. */
export interface Selection {
  /** Relative to the repository root, with forward slashes. */
  path: string;
  side: "base" | "head";
  startLine: number;
  endLine: number;
}

/** The most selected text put in a prompt for one selection. */
const maxSelectionChars = 20_000;

/**
 * The Reviewer's chat message, after the selections they sent with it, and
 * after `note` if the conversation has news for the Assistant.
 */
export function chatPrompt(
  change: Change,
  question: string,
  context: (Selection & { text: string })[],
  note?: string
): string {
  const parts: string[] = [];
  if (note) parts.push(note, "");
  if (context.length > 0) {
    parts.push("The Reviewer selected this code to ask about:", "");
    for (const selection of context) {
      const file = path.join(
        selection.side === "base" ? change.baseDir : change.headDir,
        ...selection.path.split("/")
      );
      const text =
        selection.text.length > maxSelectionChars
          ? `${selection.text.slice(0, maxSelectionChars)}\n[cut off; read the file for the rest]`
          : selection.text;
      parts.push(
        `${describeLines(selection)} of ${selection.path} on the ${selection.side} side (${file}):`,
        "```",
        text,
        "```",
        ""
      );
    }
  }
  parts.push(question);
  return parts.join("\n");
}

export function describeLines(selection: Selection): string {
  return selection.startLine === selection.endLine
    ? `line ${selection.startLine}`
    : `lines ${selection.startLine}–${selection.endLine}`;
}

/** Tells the Assistant that the Change it talked about has new commits. */
export function newHeadNote(change: Change, previousHead: string): string {
  return [
    `Since your earlier turns, the Change has new commits: its head moved from ${previousHead} to ${change.headSha}. The worktrees moved too:`,
    ...worktrees(change),
    "Files you read before may have changed, and the old worktree paths are gone.",
  ].join("\n");
}

export async function summaryPrompt(change: Change): Promise<string> {
  const files = await changedFiles(change);
  let diff = await git(
    change.repository,
    "diff",
    "--no-renames",
    change.mergeBase,
    change.headSha
  );
  const truncated = diff.length > maxDiffChars;
  if (truncated) diff = diff.slice(0, maxDiffChars);
  return [
    `The Reviewer has opened the Change ${changeTitle(change)}: from ${change.mergeBase} to ${change.headSha}.`,
    "",
    "Summarise it for them, briefly:",
    "1. What the Change does and why, as far as the code shows.",
    "2. Where the risk is: what could break, and which files or spots deserve the closest look.",
    "",
    `Changed files (${files.length}):`,
    ...files.map((f) => `- ${f.status}: ${f.path}`),
    "",
    truncated
      ? `The diff, cut off after ${maxDiffChars} characters; read the files for the rest:`
      : "The diff:",
    "```diff",
    diff,
    "```",
  ].join("\n");
}

/**
 * Asks the Assistant to explain what changed since the Reviewer's last
 * Review, which covered the commit `from`, after `note` if the conversation
 * has news for the Assistant.
 */
export async function sinceLastReviewPrompt(
  change: Change,
  from: string,
  note?: string
): Promise<string> {
  const files = await filesChangedBetween(
    change.repository,
    from,
    change.headSha
  );
  const commits = await git(
    change.repository,
    "log",
    "--format=- %h %s",
    `${from}..${change.headSha}`
  );
  let diff = await git(
    change.repository,
    "diff",
    "--no-renames",
    from,
    change.headSha
  );
  const truncated = diff.length > maxDiffChars;
  if (truncated) diff = diff.slice(0, maxDiffChars);
  return [
    ...(note ? [note, ""] : []),
    `The Reviewer's last Review of this Change covered commit ${from}. The Change is now at ${change.headSha}.`,
    "",
    "Explain to them in plain words, briefly, what changed since that Review: what the new commits do, and anything that deserves a fresh look. Leave out what they already reviewed.",
    "",
    "Commits since:",
    commits || "(none: the history was rewritten, so compare the two commits)",
    "",
    `Files changed since (${files.length}):`,
    ...files.map((f) => `- ${f.status}: ${f.path}`),
    "",
    truncated
      ? `The diff from ${from.slice(0, 7)}, cut off after ${maxDiffChars} characters; read the head worktree's files for the rest:`
      : `The diff from ${from.slice(0, 7)}:`,
    "```diff",
    diff,
    "```",
  ].join("\n");
}
