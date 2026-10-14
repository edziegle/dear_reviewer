// The Inbox tree view: the Changes waiting for the Reviewer, in groups.

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  GitHubClient,
  NotSignedInError,
  PullRequestSummary,
} from "./github/client";
import { branchesAhead, LocalBranch } from "./localBranches";
import type { LocalClone } from "./repositories";

export type { LocalClone } from "./repositories";

export type InboxNode =
  | { kind: "group"; label: string; children: InboxNode[]; count: number }
  | { kind: "problem"; message: string; action?: vscode.Command }
  | { kind: "pullRequest"; pullRequest: PullRequestSummary }
  | { kind: "localBranch"; branch: LocalBranch & LocalClone };

export class InboxTree implements vscode.TreeDataProvider<InboxNode> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private loading: Promise<InboxNode[]> | undefined;

  constructor(
    private readonly github: GitHubClient,
    private readonly repositories: () => Promise<string[]>,
    private readonly localClones: () => Promise<LocalClone[]>,
    private readonly avatars: Avatars
  ) {}

  /** Reloads the Inbox from GitHub and the local clones. */
  async refresh(): Promise<void> {
    this.loading = this.load();
    this.changed.fire();
    await this.loading;
  }

  async getChildren(node?: InboxNode): Promise<InboxNode[]> {
    if (!node) return (this.loading ??= this.load());
    if (node.kind === "group") return node.children;
    return [];
  }

  async getTreeItem(node: InboxNode): Promise<vscode.TreeItem> {
    if (node.kind === "problem") {
      const item = new vscode.TreeItem(node.message);
      item.iconPath = new vscode.ThemeIcon("error");
      item.tooltip = node.action
        ? `${node.message}\n\nClick to ${node.action.title.toLowerCase()}.`
        : node.message;
      item.command = node.action;
      return item;
    }
    if (node.kind === "group") {
      const item = new vscode.TreeItem(
        node.label,
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.description = String(node.count);
      return item;
    }
    if (node.kind === "localBranch") {
      const { branch } = node;
      const ahead = `${branch.commitsAhead} commit${branch.commitsAhead === 1 ? "" : "s"} ahead`;
      const item = new vscode.TreeItem(branch.name);
      item.description = `${branch.repository} · ${ahead}`;
      item.tooltip = new vscode.MarkdownString(
        [
          `**${escapeMarkdown(branch.name)}**`,
          `${branch.repository}, ${ahead} of ${escapeMarkdown(branch.main)}`,
          escapeMarkdown(branch.clone),
        ].join("\n\n")
      );
      item.iconPath = new vscode.ThemeIcon("git-branch");
      item.contextValue = "localBranch";
      item.command = {
        title: "Open Branch",
        command: "dearReviewer.openLocalBranch",
        arguments: [node],
      };
      return item;
    }
    const pr = node.pullRequest;
    const item = new vscode.TreeItem(pr.title);
    item.description = [
      `${pr.repository} #${pr.number}`,
      ...(pr.checks ? [`checks ${pr.checks}`] : []),
    ].join(" · ");
    item.tooltip = new vscode.MarkdownString(
      [
        `**${escapeMarkdown(pr.title)}**`,
        `${pr.repository} #${pr.number} by ${pr.author.login}`,
        pr.checks ? `Checks ${pr.checks}` : "No checks",
      ].join("\n\n")
    );
    item.iconPath =
      (await this.avatars.file(pr.author.avatarUrl)) ??
      new vscode.ThemeIcon("account");
    item.contextValue = "pullRequest";
    item.command = {
      title: "Open Pull Request",
      command: "dearReviewer.openPullRequest",
      arguments: [node],
    };
    return item;
  }

  private async load(): Promise<InboxNode[]> {
    const repositories = await this.repositories();
    await setContext("dearReviewer.hasRepositories", repositories.length > 0);
    // VS Code only shows the welcome message while the view is empty.
    if (repositories.length === 0) {
      await showWelcome("noRepositories");
      return [];
    }
    const localBranches = this.loadLocalBranches();
    try {
      const inbox = await this.github.inbox(repositories);
      await setContext("dearReviewer.signedIn", true);
      await showWelcome("none");
      return [
        pullRequestGroup("Awaiting my review", inbox.awaitingMyReview),
        pullRequestGroup("Authored by me", inbox.authoredByMe),
        ...(await localBranches),
      ];
    } catch (err) {
      if (err instanceof NotSignedInError) {
        await setContext("dearReviewer.signedIn", false);
        await showWelcome("signedOut");
        return [];
      }
      await showWelcome("none");
      const message = err instanceof Error ? err.message : String(err);
      // GitHub turned the token down: signing in again is the way out.
      const action: vscode.Command = /\b401\b/.test(message)
        ? { title: "Sign In to GitHub", command: "dearReviewer.signIn" }
        : { title: "Refresh the Inbox", command: "dearReviewer.refreshInbox" };
      return [
        {
          kind: "problem",
          message: `Couldn't load the Inbox: ${message}`,
          action,
        },
        ...(await localBranches),
      ];
    }
  }

  /** The "Local branches" group, if any Inbox repository has a local clone. */
  private async loadLocalBranches(): Promise<InboxNode[]> {
    const clones = await this.localClones();
    if (clones.length === 0) return [];
    const children: InboxNode[] = [];
    let count = 0;
    const found = await Promise.all(
      clones.map((local) =>
        branchesAhead(local.clone, local.repository).then(
          (branches) => ({ local, branches }),
          (err: unknown) => ({ local, err })
        )
      )
    );
    for (const result of found) {
      if ("err" in result) {
        const message =
          result.err instanceof Error ? result.err.message : String(result.err);
        children.push({
          kind: "problem",
          message: `Couldn't list the branches of ${result.local.repository}: ${message}`,
          action: {
            title: "Locate the clone",
            command: "dearReviewer.locateClone",
            arguments: [result.local.repository],
          },
        });
        continue;
      }
      for (const branch of result.branches) {
        children.push({
          kind: "localBranch",
          branch: { ...branch, ...result.local },
        });
        count++;
      }
    }
    return [{ kind: "group", label: "Local branches", children, count }];
  }
}

function pullRequestGroup(
  label: string,
  pullRequests: PullRequestSummary[]
): InboxNode {
  return {
    kind: "group",
    label,
    count: pullRequests.length,
    children: pullRequests.map((pullRequest) => ({
      kind: "pullRequest",
      pullRequest,
    })),
  };
}

/** Which welcome message the empty Inbox view shows (see package.json). */
function showWelcome(
  welcome: "signedOut" | "noRepositories" | "none"
): Thenable<unknown> {
  return setContext("dearReviewer.inboxWelcome", welcome);
}

/** Context keys drive the welcome messages and the setup walkthrough's checklist. */
export function setContext(key: string, value: unknown): Thenable<unknown> {
  return vscode.commands.executeCommand("setContext", key, value);
}

/** Avatars downloaded once into the extension's storage, for tree icons. */
export class Avatars {
  constructor(
    private readonly github: GitHubClient,
    /** Where the avatars are kept. */
    readonly dir: string
  ) {}

  async file(url: string): Promise<vscode.Uri | undefined> {
    if (!url) return;
    const file = path.join(
      this.dir,
      crypto.createHash("sha256").update(url).digest("hex").slice(0, 16)
    );
    if (!fs.existsSync(file)) {
      try {
        const bytes = await this.github.image(url);
        fs.mkdirSync(this.dir, { recursive: true });
        fs.writeFileSync(file, bytes);
      } catch {
        return;
      }
    }
    return vscode.Uri.file(file);
  }
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!<>|]/g, "\\$&");
}
