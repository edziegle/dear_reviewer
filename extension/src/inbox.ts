// The Inbox tree view: the Changes waiting for the Reviewer, in groups, each
// marked while it opens and once it is open.

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  GitHubClient,
  NotSignedInError,
  PullRequestSummary,
  SignInRejectedError,
} from "./github/client";
import type { Change } from "./changeWorkspace";
import {
  authoredStateLook,
  authoredStates,
  noStateIcon,
} from "./authoredStates";
import { setContext } from "./context";
import { conversationName } from "./conversationName";
import { branchesAhead, LocalBranch } from "./localBranches";
import type { LocalClone } from "./repositories";
import { messageOf } from "./errors";

export type { LocalClone } from "./repositories";

export type InboxNode =
  | { kind: "group"; label: string; children: InboxNode[]; count: number }
  | { kind: "problem"; message: string; action?: vscode.Command }
  | {
      kind: "pullRequest";
      pullRequest: PullRequestSummary;
      /** Set in Authored by me, whose rows show the pull request's states. */
      authoredByMe?: boolean;
    }
  | { kind: "localBranch"; branch: LocalBranch & LocalClone };

export class InboxTree implements vscode.TreeDataProvider<InboxNode> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  /** The latest load, which the tree shows. */
  private loading: Promise<InboxNode[]> | undefined;
  /** The number of the load started last; earlier loads are superseded. */
  private latestLoad = 0;
  /** The loads not finished yet, the latest and any it superseded. */
  private readonly inFlight = new Set<Promise<InboxNode[]>>();
  /** The pull requests and branches being opened, by their conversation name. */
  private readonly opening = new Set<string>();
  /**
   * The pull requests the Reviewer just reviewed, by `pullRequestKey`, and
   * until when the Inbox shows them as reviewed while GitHub's search still
   * lists them as awaiting review, since its index lags behind.
   */
  private readonly justReviewed = new Map<string, number>();
  private laterRefresh: NodeJS.Timeout | undefined;

  constructor(
    private readonly github: GitHubClient,
    private readonly repositories: () => Promise<string[]>,
    private readonly localClones: () => Promise<LocalClone[]>,
    private readonly avatars: Avatars,
    /** The head commit the last Brief for a local Change's conversation covered. */
    private readonly lastBriefed: (conversation: string) => string | undefined,
    /** The Changes open in any window. */
    private readonly openChanges: () => Change[]
  ) {}

  /**
   * Opens the pull request or branch of this node, marking it in the
   * Inbox, and with progress, while `open` runs.
   */
  async opened<T>(
    node: InboxNode,
    title: string,
    open: () => Promise<T>
  ): Promise<T> {
    const key = keyOf(node);
    if (key) this.opening.add(key);
    this.changed.fire();
    try {
      return await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title },
        open
      );
    } finally {
      if (key) this.opening.delete(key);
      this.changed.fire();
    }
  }

  /**
   * Moves the pull request from Awaiting my review to Reviewed by me straight
   * away, once the Reviewer submitted a Review, and loads the Inbox again
   * later, once GitHub's search has caught up with the Review.
   */
  reviewed(pullRequest: { repository: string; number: number }): void {
    this.justReviewed.set(
      pullRequestKey(pullRequest),
      Date.now() + keepReviewed
    );
    this.changed.fire();
    clearTimeout(this.laterRefresh);
    this.laterRefresh = setTimeout(() => {
      this.laterRefresh = undefined;
      void this.refresh();
    }, refreshAfterReview);
  }

  /** Runs the refresh due after a Review now, and waits until no load is in flight. */
  async settled(): Promise<void> {
    if (this.laterRefresh) {
      clearTimeout(this.laterRefresh);
      this.laterRefresh = undefined;
      void this.refresh();
    }
    while (this.inFlight.size > 0) await Promise.allSettled(this.inFlight);
  }

  dispose(): void {
    clearTimeout(this.laterRefresh);
  }

  /** Shows afresh which pull requests and branches are open, without reloading. */
  redraw(): void {
    this.changed.fire();
  }

  /** Reloads the Inbox from GitHub and the local clones. */
  async refresh(): Promise<void> {
    const loading = this.startLoad();
    this.changed.fire();
    await loading;
  }

  async getChildren(node?: InboxNode): Promise<InboxNode[]> {
    if (!node)
      return this.withJustReviewed(await (this.loading ?? this.startLoad()));
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
      const briefed = this.lastBriefed(
        conversationName({
          kind: "branch",
          branch: branch.name,
          repository: branch.clone,
        })
      );
      const changedSinceReview =
        briefed !== undefined && briefed !== branch.headSha;
      const item = new vscode.TreeItem(branch.name);
      item.description = [
        branch.repository,
        ahead,
        ...(changedSinceReview ? ["new commits since my Review"] : []),
        ...this.openState(node),
      ].join(" · ");
      item.tooltip = new vscode.MarkdownString(
        [
          `**${escapeMarkdown(branch.name)}**`,
          `${branch.repository}, ${ahead} of ${escapeMarkdown(branch.main)}`,
          escapeMarkdown(branch.clone),
          ...(changedSinceReview
            ? [
                `New commits since my last Review, whose Brief covered ${briefed.slice(0, 7)}`,
              ]
            : []),
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
    const changedSinceReview =
      pr.lastReviewedSha !== undefined && pr.lastReviewedSha !== pr.headSha;
    const states = node.authoredByMe ? authoredStates(pr) : [];
    // The checks already say when they failed.
    const stateLooks = states
      .filter((state) => state !== "checksFailed")
      .map((state) => authoredStateLook(state, pr));
    item.description = [
      `${pr.repository} #${pr.number}`,
      ...(pr.checks ? [`checks ${pr.checks}`] : []),
      ...stateLooks.map((look) => look.description),
      ...(changedSinceReview ? ["new commits since my Review"] : []),
      ...this.openState(node),
    ].join(" · ");
    item.tooltip = new vscode.MarkdownString(
      [
        `**${escapeMarkdown(pr.title)}**`,
        `${pr.repository} #${pr.number} by ${pr.author.login}`,
        pr.checks ? `Checks ${pr.checks}` : "No checks",
        ...stateLooks.map((look) => escapeMarkdown(look.tooltip)),
        ...(changedSinceReview
          ? [
              `New commits since my last Review, at ${pr.lastReviewedSha!.slice(0, 7)}`,
            ]
          : []),
      ].join("\n\n")
    );
    if (node.authoredByMe) {
      const look = states[0] && authoredStateLook(states[0], pr);
      item.iconPath = look
        ? new vscode.ThemeIcon(look.icon, new vscode.ThemeColor(look.color))
        : new vscode.ThemeIcon(noStateIcon);
    } else
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

  /** "opening…" while the node's Change opens, "open" once it is. */
  private openState(node: InboxNode): string[] {
    const key = keyOf(node);
    if (!key) return [];
    if (this.opening.has(key)) return ["opening…"];
    return this.openChanges().some((change) => change.conversation === key)
      ? ["open"]
      : [];
  }

  private startLoad(): Promise<InboxNode[]> {
    const loading = this.load();
    this.loading = loading;
    this.inFlight.add(loading);
    const done = () => void this.inFlight.delete(loading);
    loading.then(done, done);
    return loading;
  }

  /** Loads the Inbox, and sets its context keys unless a later load superseded this one. */
  private async load(): Promise<InboxNode[]> {
    const thisLoad = ++this.latestLoad;
    const superseded = () => thisLoad !== this.latestLoad;
    const repositories = await this.repositories();
    if (!superseded())
      await setContext("dearReviewer.hasRepositories", repositories.length > 0);
    const loaded = await this.fetch(repositories);
    if (superseded()) return loaded.nodes;
    if (loaded.awaitingMyReview)
      this.forgetReviewedOnceSearchHasCaughtUp(loaded.awaitingMyReview);
    if (loaded.signedIn !== undefined)
      await setContext("dearReviewer.signedIn", loaded.signedIn);
    // VS Code only shows the welcome message while the view is empty.
    await showWelcome(loaded.welcome);
    return loaded.nodes;
  }

  private async fetch(repositories: string[]): Promise<InboxLoad> {
    if (repositories.length === 0)
      return { nodes: [], welcome: "noRepositories" };
    const localBranches = this.loadLocalBranches();
    try {
      const inbox = await this.github.inbox(repositories);
      return {
        nodes: [
          pullRequestGroup(awaitingMyReview, inbox.awaitingMyReview),
          pullRequestGroup("Authored by me", inbox.authoredByMe, {
            authoredByMe: true,
          }),
          pullRequestGroup(reviewedByMe, inbox.reviewedByMe),
          ...(await localBranches),
        ],
        signedIn: true,
        welcome: "none",
        awaitingMyReview: inbox.awaitingMyReview,
      };
    } catch (err) {
      if (err instanceof NotSignedInError)
        return {
          nodes: [],
          signedIn: false,
          welcome: "signedOut",
        };
      const message = messageOf(err);
      const action: vscode.Command =
        err instanceof SignInRejectedError
          ? { title: "Sign In to GitHub", command: "dearReviewer.signIn" }
          : {
              title: "Refresh the Inbox",
              command: "dearReviewer.refreshInbox",
            };
      return {
        nodes: [
          {
            kind: "problem",
            message: `Couldn't load the Inbox: ${message}`,
            action,
          },
          ...(await localBranches),
        ],
        welcome: "none",
      };
    }
  }

  private forgetReviewedOnceSearchHasCaughtUp(
    awaiting: PullRequestSummary[]
  ): void {
    const listed = new Set(awaiting.map(pullRequestKey));
    for (const [key, until] of this.justReviewed)
      if (!listed.has(key) || until < Date.now()) this.justReviewed.delete(key);
  }

  /** The groups, with the pull requests just reviewed moved from Awaiting my review to Reviewed by me. */
  private withJustReviewed(nodes: InboxNode[]): InboxNode[] {
    const reviewed = (node: InboxNode) =>
      node.kind === "pullRequest" &&
      (this.justReviewed.get(pullRequestKey(node.pullRequest)) ?? 0) >=
        Date.now();
    const awaiting = nodes.find(
      (n) => n.kind === "group" && n.label === awaitingMyReview
    );
    const moved =
      awaiting?.kind === "group" ? awaiting.children.filter(reviewed) : [];
    if (moved.length === 0) return nodes;
    return nodes.map((node) => {
      if (node.kind !== "group") return node;
      if (node.label === awaitingMyReview) {
        const children = node.children.filter((child) => !reviewed(child));
        return { ...node, children, count: children.length };
      }
      if (node.label === reviewedByMe) {
        const children = [...moved, ...node.children];
        return { ...node, children, count: children.length };
      }
      return node;
    });
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
        const message = messageOf(result.err);
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

/** A load of the Inbox, and what it says about the Reviewer's setup. */
interface InboxLoad {
  nodes: InboxNode[];
  /** Unknown when GitHub failed otherwise than for want of a sign-in. */
  signedIn?: boolean;
  welcome: Welcome;
  awaitingMyReview?: PullRequestSummary[];
}

/** How long after a Review the Inbox loads again, once search has caught up. */
const refreshAfterReview = 20_000;
/** How long the Inbox at most shows a reviewed pull request as reviewed against search. */
const keepReviewed = 120_000;

const awaitingMyReview = "Awaiting my review";
const reviewedByMe = "Reviewed by me";

function pullRequestKey(pullRequest: {
  repository: string;
  number: number;
}): string {
  return `${pullRequest.repository.toLowerCase()}#${pullRequest.number}`;
}

/** The conversation name of the Change a pull request or branch opens as. */
function keyOf(node: InboxNode): string | undefined {
  if (node.kind === "pullRequest")
    return conversationName({
      kind: "pullRequest",
      pullRequest: node.pullRequest,
    });
  if (node.kind === "localBranch")
    return conversationName({
      kind: "branch",
      branch: node.branch.name,
      repository: node.branch.clone,
    });
}

function pullRequestGroup(
  label: string,
  pullRequests: PullRequestSummary[],
  { authoredByMe = false } = {}
): InboxNode {
  return {
    kind: "group",
    label,
    count: pullRequests.length,
    children: pullRequests.map((pullRequest) => ({
      kind: "pullRequest",
      pullRequest,
      ...(authoredByMe && { authoredByMe }),
    })),
  };
}

type Welcome = "signedOut" | "noRepositories" | "none";

/** Which welcome message the empty Inbox view shows (see package.json). */
function showWelcome(welcome: Welcome): Thenable<unknown> {
  return setContext("dearReviewer.inboxWelcome", welcome);
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
