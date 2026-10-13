// What Dear Reviewer tells the Assistant.

import { Change, changedFiles, changeTitle } from "../changeWorkspace";
import { git } from "../git";

/** The most diff text put in a prompt; the Assistant can read the rest itself. */
const maxDiffChars = 60_000;

export function assistantRole(change: Change): string {
  return [
    "You are the Assistant in Dear Reviewer, a workbench for a human Reviewer reviewing a Change.",
    "You help the Reviewer understand the Change: you summarise, answer questions and point at spots that deserve attention.",
    "You never review, approve or decide anything, and you never publish anything. You can only read files.",
    `Your working directory is the Change's head worktree, at commit ${change.headSha}.`,
    `The base worktree, at the merge base ${change.mergeBase}, is ${change.baseDir}. Compare the two to see what changed.`,
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
