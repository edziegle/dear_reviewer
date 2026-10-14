// Sets up the fake GitHub server, signs the Reviewer in, and reads the Inbox
// the way the Reviewer sees it.

import * as vscode from "vscode";
import type {
  FakeGitHubState,
  FakePullRequest,
  RecordedMutation,
  RecordedRequest,
} from "../fakeGitHub";

export { fakePullRequestId } from "../fakeGitHub";
export type { FakePullRequest, RecordedMutation, RecordedRequest };

export function fakeGitHubUrl(): string {
  const url = process.env.DEAR_REVIEWER_FAKE_GITHUB;
  if (!url) throw new Error("DEAR_REVIEWER_FAKE_GITHUB is not set");
  return url;
}

/** Replaces what the fake GitHub serves, and forgets the requests it saw. */
export async function serveGitHub(state: FakeGitHubState): Promise<void> {
  const res = await fetch(`${fakeGitHubUrl()}/_fake/state`, {
    method: "PUT",
    body: JSON.stringify(state),
  });
  if (!res.ok) throw new Error(`fake GitHub refused the state: ${res.status}`);
}

export async function requestsToGitHub(): Promise<RecordedRequest[]> {
  const res = await fetch(`${fakeGitHubUrl()}/_fake/requests`);
  return (await res.json()) as RecordedRequest[];
}

/** The viewed marks the fake GitHub received, oldest first. */
export async function viewedMarksOnGitHub(): Promise<RecordedMutation[]> {
  const res = await fetch(`${fakeGitHubUrl()}/_fake/mutations`);
  return (await res.json()) as RecordedMutation[];
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
  /** The tree element, for passing to the view's commands. */
  node?: unknown;
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

async function inboxProvider(): Promise<vscode.TreeDataProvider<unknown>> {
  const extension = vscode.extensions.getExtension<{
    inbox: vscode.TreeDataProvider<unknown>;
  }>("edziegle.dear-reviewer");
  if (!extension) throw new Error("Dear Reviewer is not installed");
  return (await extension.activate()).inbox;
}

function entryOf(item: vscode.TreeItem): InboxEntry {
  const label =
    typeof item.label === "string" ? item.label : (item.label?.label ?? "");
  const entry: InboxEntry = { label };
  if (item.description !== undefined && item.description !== false)
    entry.description = String(item.description);
  const icon = item.iconPath;
  if (icon instanceof vscode.Uri) entry.icon = icon.fsPath;
  else if (icon instanceof vscode.ThemeIcon) entry.icon = `$(${icon.id})`;
  return entry;
}
