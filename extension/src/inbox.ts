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

export type InboxNode =
  | { kind: "group"; label: string; pullRequests: PullRequestSummary[] }
  | { kind: "problem"; message: string }
  | { kind: "pullRequest"; pullRequest: PullRequestSummary };

export class InboxTree implements vscode.TreeDataProvider<InboxNode> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private loading: Promise<InboxNode[]> | undefined;

  constructor(
    private readonly github: GitHubClient,
    private readonly repositories: () => string[],
    private readonly avatars: Avatars
  ) {}

  /** Reloads the Inbox from GitHub. */
  async refresh(): Promise<void> {
    this.loading = this.load();
    this.changed.fire();
    await this.loading;
  }

  async getChildren(node?: InboxNode): Promise<InboxNode[]> {
    if (!node) return (this.loading ??= this.load());
    if (node.kind === "group")
      return node.pullRequests.map((pullRequest) => ({
        kind: "pullRequest",
        pullRequest,
      }));
    return [];
  }

  async getTreeItem(node: InboxNode): Promise<vscode.TreeItem> {
    if (node.kind === "problem") {
      const item = new vscode.TreeItem(node.message);
      item.iconPath = new vscode.ThemeIcon("error");
      item.tooltip = node.message;
      return item;
    }
    if (node.kind === "group") {
      const item = new vscode.TreeItem(
        node.label,
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.description = String(node.pullRequests.length);
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
    return item;
  }

  private async load(): Promise<InboxNode[]> {
    const repositories = this.repositories();
    try {
      const inbox = await this.github.inbox(repositories);
      await showWelcome(repositories.length === 0 ? "noRepositories" : "none");
      return [
        {
          kind: "group",
          label: "Awaiting my review",
          pullRequests: inbox.awaitingMyReview,
        },
        {
          kind: "group",
          label: "Authored by me",
          pullRequests: inbox.authoredByMe,
        },
      ];
    } catch (err) {
      if (err instanceof NotSignedInError) {
        await showWelcome("signedOut");
        return [];
      }
      await showWelcome("none");
      const message = err instanceof Error ? err.message : String(err);
      return [
        { kind: "problem", message: `Couldn't load the Inbox: ${message}` },
      ];
    }
  }
}

/** Which welcome message the empty Inbox view shows (see package.json). */
function showWelcome(
  welcome: "signedOut" | "noRepositories" | "none"
): Thenable<unknown> {
  return vscode.commands.executeCommand(
    "setContext",
    "dearReviewer.inboxWelcome",
    welcome
  );
}

/** Avatars downloaded once into the extension's storage, for tree icons. */
export class Avatars {
  constructor(
    private readonly github: GitHubClient,
    private readonly dir: string
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
