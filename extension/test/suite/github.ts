// Sets up the fake GitHub server, signs the Reviewer in, and reads the Inbox
// the way the Reviewer sees it.

import { strict as assert } from "assert";
import * as vscode from "vscode";
import type {
  FakeGitHubState,
  FakePullRequest,
  RecordedMutation,
  RecordedRequest,
  RecordedResolution,
  RecordedReview,
} from "../fakeGitHub";

export { fakePullRequestId } from "../fakeGitHub";
export type {
  FakePullRequest,
  RecordedMutation,
  RecordedRequest,
  RecordedResolution,
  RecordedReview,
};

export function fakeGitHubUrl(): string {
  const url = process.env.DEAR_REVIEWER_FAKE_GITHUB;
  if (!url) throw new Error("DEAR_REVIEWER_FAKE_GITHUB is not set");
  return url;
}

/** Replaces what the fake GitHub serves, and forgets the requests it saw once the Inbox settles. */
/**
 * Replaces the fake GitHub's fixtures, once the Inbox's refreshes have
 * landed, unless `settle` is false, which leaves a later refresh due to
 * load the new fixtures.
 */
export async function serveGitHub(
  state: FakeGitHubState,
  { settle = true } = {}
): Promise<void> {
  if (settle) await inboxSettled();
  const res = await fetch(`${fakeGitHubUrl()}/_fake/state`, {
    method: "PUT",
    body: JSON.stringify(state),
  });
  if (!res.ok) throw new Error(`fake GitHub refused the state: ${res.status}`);
}

/** The requests the fake GitHub saw, once the Inbox's refreshes have landed. */
export async function requestsToGitHub(): Promise<RecordedRequest[]> {
  await inboxSettled();
  const res = await fetch(`${fakeGitHubUrl()}/_fake/requests`);
  return (await res.json()) as RecordedRequest[];
}

/** The viewed marks the fake GitHub received, oldest first. */
export async function viewedMarksOnGitHub(): Promise<RecordedMutation[]> {
  const res = await fetch(`${fakeGitHubUrl()}/_fake/mutations`);
  return (await res.json()) as RecordedMutation[];
}

/** The threads the fake GitHub was asked to resolve or unresolve, oldest first. */
export async function resolutionsOnGitHub(): Promise<RecordedResolution[]> {
  const res = await fetch(`${fakeGitHubUrl()}/_fake/resolutions`);
  return (await res.json()) as RecordedResolution[];
}

/** Every pull request's reviews on the fake GitHub, as they are now. */
export async function reviewsOnGitHub(): Promise<RecordedReview[]> {
  const res = await fetch(`${fakeGitHubUrl()}/_fake/reviews`);
  return (await res.json()) as RecordedReview[];
}

export async function avatarServedFor(login: string): Promise<Buffer> {
  const res = await fetch(`${fakeGitHubUrl()}/avatars/${login}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Points Dear Reviewer at the fake GitHub and lists the Inbox's repositories. */
export async function configure(settings: {
  repositories: string[];
  apiUrl?: string;
}): Promise<void> {
  const config = vscode.workspace.getConfiguration("dearReviewer");
  const global = vscode.ConfigurationTarget.Global;
  await config.update(
    "githubApiUrl",
    settings.apiUrl ?? fakeGitHubUrl(),
    global
  );
  await config.update("repositories", settings.repositories, global);
}

export function setToken(token: string): Thenable<unknown> {
  return vscode.commands.executeCommand("dearReviewer.setToken", token);
}

export function forgetToken(): Thenable<unknown> {
  return vscode.commands.executeCommand("dearReviewer.forgetToken");
}

export function refreshInbox(): Thenable<unknown> {
  return vscode.commands.executeCommand("dearReviewer.refreshInbox");
}

export interface InboxEntry {
  label: string;
  description?: string;
  /** A file path for an image icon, or `$(id)` for a theme icon. */
  icon?: string;
  /** A theme icon's colour, by its theme colour id. */
  iconColor?: string;
  /** The tooltip's text, Markdown as written. */
  tooltip?: string;
  /** The tree element, for passing to the view's commands. */
  node?: unknown;
  /** What clicking the entry runs. */
  command?: vscode.Command;
}

/** Clicks the Inbox entry, as the Reviewer does in the tree. */
export async function click(entry: InboxEntry): Promise<unknown> {
  assert(entry.command, `clicking "${entry.label}" does nothing`);
  return vscode.commands.executeCommand(
    entry.command.command,
    ...(entry.command.arguments ?? [])
  );
}

/** Opens the pull request from the Inbox entry's context menu. */
export function openFromInbox(entry: InboxEntry): Thenable<unknown> {
  return vscode.commands.executeCommand(
    "dearReviewer.openPullRequest",
    entry.node
  );
}

/** Opens the local branch from the Inbox entry's context menu. */
export function openBranchFromInbox(entry: InboxEntry): Thenable<unknown> {
  return vscode.commands.executeCommand(
    "dearReviewer.openLocalBranch",
    entry.node
  );
}

/** Finds the Inbox entry with this label, in any group. */
export function inboxEntry(groups: InboxGroup[], label: string): InboxEntry {
  const entry = groups.flatMap((g) => g.entries).find((e) => e.label === label);
  if (!entry)
    throw new Error(`no "${label}" in the Inbox: ${JSON.stringify(groups)}`);
  return entry;
}

export interface InboxGroup extends InboxEntry {
  entries: InboxEntry[];
}

/** The Inbox tree as the view shows it, fully expanded. */
export async function inbox(): Promise<InboxGroup[]> {
  const provider = await inboxProvider();
  const groups: InboxGroup[] = [];
  for (const element of (await provider.getChildren()) ?? []) {
    const children = (await provider.getChildren(element)) ?? [];
    groups.push({
      ...entryOf(await provider.getTreeItem(element)),
      entries: await Promise.all(
        children.map(async (child) => ({
          ...entryOf(await provider.getTreeItem(child)),
          node: child,
        }))
      ),
    });
  }
  return groups;
}

/** Waits for the Inbox's refreshes, running the one due after a Review now. */
export async function inboxSettled(): Promise<void> {
  const extension = dearReviewer();
  if (extension.isActive) await extension.exports.inbox.settled();
}

/** The searches for pull requests awaiting the Reviewer's review that the Inbox sent, oldest first. */
export async function awaitingSearches(): Promise<RecordedRequest[]> {
  return (await requestsToGitHub()).filter((request) =>
    JSON.stringify(request.body ?? "").includes("review-requested:@me")
  );
}

type InboxProvider = vscode.TreeDataProvider<unknown> & {
  settled(): Promise<void>;
};

function dearReviewer(): vscode.Extension<{ inbox: InboxProvider }> {
  const extension = vscode.extensions.getExtension<{ inbox: InboxProvider }>(
    "edziegle.dear-reviewer"
  );
  if (!extension) throw new Error("Dear Reviewer is not installed");
  return extension;
}

async function inboxProvider(): Promise<InboxProvider> {
  return (await dearReviewer().activate()).inbox;
}

function entryOf(item: vscode.TreeItem): InboxEntry {
  const label =
    typeof item.label === "string" ? item.label : (item.label?.label ?? "");
  const entry: InboxEntry = { label };
  if (item.description !== undefined && item.description !== false)
    entry.description = String(item.description);
  const icon = item.iconPath;
  if (item.command) entry.command = item.command;
  if (icon instanceof vscode.Uri) entry.icon = icon.fsPath;
  else if (icon instanceof vscode.ThemeIcon) {
    entry.icon = `$(${icon.id})`;
    if (icon.color) entry.iconColor = icon.color.id;
  }
  const tooltip = item.tooltip;
  if (typeof tooltip === "string") entry.tooltip = tooltip;
  else if (tooltip) entry.tooltip = tooltip.value;
  return entry;
}

/** The repositories the Inbox searched GitHub for, in the requests it sent. */
export async function searchedRepositories(): Promise<string[]> {
  const found = new Set<string>();
  for (const request of await requestsToGitHub()) {
    const variables = (request.body as { variables?: Record<string, unknown> })
      ?.variables;
    for (const value of Object.values(variables ?? {})) {
      if (typeof value !== "string") continue;
      for (const match of value.matchAll(/\brepo:(\S+)/g)) found.add(match[1]);
    }
  }
  return [...found].sort();
}

/** Adds the folder's GitHub repository to the Inbox, as if picked in the folder picker. */
export function addRepository(folder: string): Thenable<string | undefined> {
  return vscode.commands.executeCommand("dearReviewer.addRepository", folder);
}

/** Tells Dear Reviewer where the repository is cloned, as if picked in the folder picker. */
export function locateClone(
  repository: string,
  folder: string
): Thenable<string | undefined> {
  return vscode.commands.executeCommand(
    "dearReviewer.locateClone",
    repository,
    folder
  );
}

/** Forgets a repository Dear Reviewer remembered from a window or a picker. */
export function forgetRepository(repository: string): Thenable<unknown> {
  return vscode.commands.executeCommand(
    "dearReviewer.forgetRepository",
    repository
  );
}
