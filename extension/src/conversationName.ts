// What a Change is across new commits, which give it a new id: its pull
// request, or else the local branch it was opened at, or else its commit
// range (see ADR 0009). The Change's Assistant conversation, local Review and
// Briefs are kept in the extension's storage under the name this gives, so
// the names' format must stay as it is for saved conversations to resume.

import * as crypto from "crypto";
import * as path from "path";
import { git } from "./git";
import type { PullRequestRef } from "./openChanges";

export type ConversationId =
  | { kind: "pullRequest"; pullRequest: PullRequestRef }
  | { kind: "branch"; branch: string; repository: string }
  | { kind: "range"; mergeBase: string; headSha: string; repository: string };

/** The name a Change keeps its conversation, local Review and Briefs under. */
export function conversationName(id: ConversationId): string {
  switch (id.kind) {
    case "pullRequest":
      return `pull request ${id.pullRequest.repository.toLowerCase()}#${id.pullRequest.number}`;
    case "branch":
      return `branch ${id.branch} in ${path.resolve(id.repository)}`;
    case "range":
      return `range ${id.mergeBase}..${id.headSha} in ${id.repository}`;
  }
}

/**
 * The conversation name of the Change a request opens: its pull request, or
 * else the local branch the request named (`HEAD` names the checked-out
 * branch), or else the commit range itself, which `range` gives.
 */
export async function conversationOf(
  repository: string,
  request: { head: string; pullRequest?: PullRequestRef },
  range: () => Promise<{ mergeBase: string; headSha: string }>
): Promise<string> {
  if (request.pullRequest)
    return conversationName({
      kind: "pullRequest",
      pullRequest: request.pullRequest,
    });
  const ref = await git(
    repository,
    "rev-parse",
    "--symbolic-full-name",
    request.head
  ).catch(() => "");
  if (ref.startsWith("refs/heads/"))
    return conversationName({
      kind: "branch",
      branch: ref.slice("refs/heads/".length),
      repository,
    });
  return conversationName({ kind: "range", ...(await range()), repository });
}

/**
 * The name of the folder `claude` runs in for the conversation, the same
 * for as long as the conversation lasts.
 */
export function conversationFolder(name: string): string {
  return crypto.createHash("sha256").update(name).digest("hex").slice(0, 16);
}

/** What a conversation name names, if it is one `conversationName` gives. */
export function parseConversationName(
  name: string
): ConversationId | undefined {
  const pullRequest = /^pull request ([^#\s]+)#(\d+)$/.exec(name);
  if (pullRequest)
    return {
      kind: "pullRequest",
      pullRequest: {
        repository: pullRequest[1],
        number: Number(pullRequest[2]),
      },
    };
  // Git allows no spaces in a branch name, so the first " in " ends it.
  const branch = /^branch (\S+) in (.+)$/.exec(name);
  if (branch)
    return { kind: "branch", branch: branch[1], repository: branch[2] };
  const range = /^range ([0-9a-f]+)\.\.([0-9a-f]+) in (.+)$/.exec(name);
  if (range)
    return {
      kind: "range",
      mergeBase: range[1],
      headSha: range[2],
      repository: range[3],
    };
}

/** The local branch a conversation name gives, if it names one. */
export function branchOfConversation(name: string): string | undefined {
  const id = parseConversationName(name);
  return id?.kind === "branch" ? id.branch : undefined;
}
