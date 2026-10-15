// What Dear Reviewer tells the Assistant.

import * as path from "path";
import {
  Change,
  changedFiles,
  changeTitle,
  filesChangedBetween,
} from "../changeWorkspace";
import { branchOfConversation } from "../conversationName";
import { git, gitOutput } from "../git";
import type { LocalThread } from "../localReviews";

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
  /**
   * The worktree the lines are in, or `commit` for lines of the reviewed
   * commit's side of what changed since the last Review, which no worktree has.
   */
  side: "base" | "head" | "commit";
  /** The commit a `commit` side's lines are from. */
  commit?: string;
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
      const text =
        selection.text.length > maxSelectionChars
          ? `${selection.text.slice(0, maxSelectionChars)}\n[cut off; read the file for the rest]`
          : selection.text;
      parts.push(
        `${describeLines(selection)} of ${selection.path} ${whereSelected(change, selection)}:`,
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

function whereSelected(change: Change, selection: Selection): string {
  if (selection.side === "commit")
    return `at commit ${selection.commit}, which neither worktree has`;
  const file = path.join(
    selection.side === "base" ? change.baseDir : change.headDir,
    ...selection.path.split("/")
  );
  return `on the ${selection.side} side (${file})`;
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

/**
 * Asks for the short summary the Change's overview shows: what the Change
 * does and where to start reading, since the Reviewer reads the diff itself.
 */
export async function summaryPrompt(change: Change): Promise<string> {
  const files = await changedFiles(change);
  const { diff, truncated } = await cappedDiff(
    change.repository,
    change.mergeBase,
    change.headSha
  );
  return [
    `The Reviewer has opened the Change ${changeTitle(change)}: from ${change.mergeBase} to ${change.headSha}.`,
    "",
    "Summarise it for them in one short paragraph of plain prose: at most three sentences and about 60 words, with no headings, lists or code blocks.",
    "Say what the Change does and why, as far as the code shows. Then say where to start reading, as one `path:line` reference to a changed file in the head worktree, and why there.",
    "Don't go through the files one by one or list risks: the Reviewer reads the diff themselves, and asks for Findings when they want them.",
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
 * Asks for a Reading Order, as a JSON object that `parseReadingOrder` reads,
 * after `note` if the conversation has news for the Assistant. It follows
 * the summary in the same conversation, so it starts where the summary does.
 */
export function readingOrderPrompt(
  files: string[],
  start: string | undefined,
  note?: string
): string {
  return [
    ...(note ? [note, ""] : []),
    "Suggest a Reading Order for the Reviewer: the order to read the Change's files in, so the Change reads as a story, such as an interface before its callers, the core change before the plumbing, and tests last.",
    "",
    start
      ? `- Start with ${start}, where your summary says to start.`
      : "- Start where your summary says to start.",
    "- Group the files into a few steps, each with a label of a few words.",
    "- Give each file a few words on why it comes there.",
    "- List every changed file once, by its path relative to the repository root.",
    "- Reply with only a JSON object of this shape, with no Markdown fence or prose around it:",
    '{"steps": [{"label": "The API shape", "files": [{"path": "src/api.ts", "why": "the new interface"}]}]}',
    "",
    `Changed files (${files.length}):`,
    ...files.map((f) => `- ${f}`),
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
  const { diff, truncated } = await cappedDiff(
    change.repository,
    from,
    change.headSha
  );
  return [
    ...(note ? [note, ""] : []),
    `The Reviewer's last Review of this Change covered commit ${from}. The Change is now at ${change.headSha}.`,
    "",
    "Explain what changed since that Review in one short paragraph of plain prose: at most three sentences and about 60 words, with no headings, lists or code blocks. Say what the new commits do, then where to look first, as one `path:line` reference to a file they changed. Leave out what the Reviewer already reviewed.",
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

/** The most Findings Dear Reviewer asks for. */
export const maxFindings = 20;

/**
 * Asks the Assistant for Findings in the Change, as a JSON object that
 * `parseFindings` reads, after `note` if the conversation has news for the
 * Assistant. Each Finding is on lines of one side's diff, where the
 * Reviewer can turn it into a Comment.
 */
export async function findingsPrompt(
  change: Change,
  note?: string
): Promise<string> {
  const files = await changedFiles(change);
  const { diff, truncated } = await cappedDiff(
    change.repository,
    change.mergeBase,
    change.headSha
  );
  return [
    ...(note ? [note, ""] : []),
    `The Reviewer asks you to look over the Change ${changeTitle(change)}, from ${change.mergeBase} to ${change.headSha}, and raise Findings: spots in it that deserve their attention, such as bugs, missed edge cases, security problems or code that misleads.`,
    "",
    `- Raise only what matters, at most ${maxFindings}, most important first. No Findings is a fine answer.`,
    "- Each Finding sits on lines the diff shows, counting its three lines of context: on the head side for new or changed code, or on the base side for removed code. The Reviewer may turn it into a Comment there, and GitHub takes Comments on no other lines.",
    "- Give the file's path relative to the repository root, and its lines counted from 1 in that side's file.",
    "- Say in a sentence or two what deserves attention and why. Address the Reviewer, not the author, and propose no code.",
    "- Read the worktrees' files if you need more context.",
    "- Reply with only a JSON object of this shape, with no Markdown fence or prose around it:",
    '{"findings": [{"path": "src/app.py", "side": "head", "startLine": 12, "endLine": 14, "message": "What deserves attention, and why."}]}',
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
 * Asks the Assistant to turn the Reviewer's Comments on a local Change into
 * a Brief for an agent, after `note` if the conversation has news for the
 * Assistant. Each Comment comes with its file, side, lines and code.
 */
export async function briefPrompt(
  change: Change,
  threads: LocalThread[],
  note?: string
): Promise<string> {
  const branch = branchOfConversation(change.conversation);
  const comments = await Promise.all(
    threads.map(async (thread, i) => {
      const side = thread.side === "LEFT" ? "base" : "head";
      const current =
        thread.side === "LEFT" ? change.mergeBase : change.headSha;
      const first = thread.startLine ?? thread.line;
      const lines = await linesAt(
        change.repository,
        thread.commit,
        thread.path,
        first,
        thread.line
      );
      const reference = `${thread.path}:${first === thread.line ? first : `${first}-${thread.line}`}`;
      return [
        `${i + 1}. ${reference} on the ${side} side${thread.commit === current ? "" : `, written at the older commit ${thread.commit}, so those lines may have moved since`}:`,
        ...(lines === undefined ? [] : ["```", lines, "```"]),
        ...thread.comments.map((c) => c.body),
        "",
      ].join("\n");
    })
  );
  return [
    ...(note ? [note, ""] : []),
    `The Reviewer has ended their Review of the Change ${changeTitle(change)}${branch ? `, the branch ${branch}` : ""}: from ${change.mergeBase} to ${change.headSha}.`,
    "",
    `Turn their Comments, below, into a Brief: instructions that a coding agent working on ${branch ? `the branch ${branch}` : "this code"} can act on to address them.`,
    "- Cover every Comment, and only what the Reviewer asked for or questioned. Keep their intent; don't add requests of your own.",
    "- Point at the code with its path relative to the repository root and its lines at the head commit, such as `src/app.py:12` or `src/app.py:12-30`. A Comment on the base side is about the code as it was before the Change.",
    "- Read the worktrees' files if you need more context.",
    "- Reply with only the Brief, in Markdown, with no preamble: it goes to the agent as you write it.",
    "",
    `The Reviewer's Comments (${threads.length}):`,
    "",
    ...comments,
  ].join("\n");
}

/** Lines of a file at a commit, counted from 1, if the commit has the file. */
async function linesAt(
  repository: string,
  commit: string,
  file: string,
  first: number,
  last: number
): Promise<string | undefined> {
  try {
    const text = await gitOutput(repository, "show", `${commit}:${file}`);
    return text
      .split("\n")
      .slice(first - 1, last)
      .join("\n");
  } catch {
    return undefined;
  }
}

/** The diff between two commits, cut off after `maxDiffChars`. */
async function cappedDiff(
  repository: string,
  from: string,
  to: string
): Promise<{ diff: string; truncated: boolean }> {
  const diff = await git(repository, "diff", "--no-renames", from, to);
  const truncated = diff.length > maxDiffChars;
  return { diff: truncated ? diff.slice(0, maxDiffChars) : diff, truncated };
}
