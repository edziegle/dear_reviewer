// Home (ADR 0025): the review window's page of where the Reviewer stands
// across their Changes. It shows when no Change is in front, and when the
// Reviewer asks for it. Its lists come from the Inbox's own load and the
// overview's standing, so Home, the Inbox and the overview never disagree,
// and it shows them afresh whenever those change.

import * as path from "path";
import * as vscode from "vscode";
import { authoredStateLook, authoredStates } from "../authoredStates";
import { changeName, pullRequestName, type Change } from "../changeWorkspace";
import { branchOfConversation, conversationName } from "../conversationName";
import type { PullRequestSummary } from "../github/client";
import {
  authoredByMe,
  awaitingMyReview,
  type Avatars,
  type InboxNode,
  type InboxTree,
  type Welcome,
} from "../inbox";
import type { Standing } from "../timeline/timelines";
import { byLongestWait, homeFacts, nextStep, waitedFor } from "./homeState";
import {
  HomePanel,
  type FromHome,
  type HomeAction,
  type HomeBranch,
  type HomeChange,
  type HomeProblem,
  type HomePullRequest,
  type HomeState,
} from "./panel";

/** What Home learns from the rest of Dear Reviewer, and how it acts. */
export interface HomeSources {
  /** The Changes this window shows, the one shown last last. */
  inProgress(): Change[];
  /** Where the Reviewer stands on the Change. */
  standing(change: Change): Promise<Standing>;
  /** Brings the Change to the front, with its overview. */
  resume(change: Change): void;
  /** Starts finishing the Change's Review: Submit Review… or Write Brief…. */
  finish(change: Change): void;
  /** Opens the Inbox's pull request or branch as a Change. */
  open(node: InboxNode): void;
  /** Loads the Inbox again, as its Refresh does. */
  refresh(): void;
}

export class Home implements vscode.Disposable {
  private panel?: HomePanel;
  private state: HomeState = emptyState();
  /** What Home's buttons act on, by the id the webview names them by. */
  private targets = emptyTargets();
  private timer?: NodeJS.Timeout;
  /** The Inbox's latest load, once one is in. */
  private lastContents?: { groups: InboxNode[]; welcome: Welcome };
  /** The number of the update started last; earlier ones don't show. */
  private latest = 0;
  private readonly subscriptions: vscode.Disposable[];

  constructor(
    private readonly inbox: InboxTree,
    private readonly avatars: Avatars,
    private readonly sources: HomeSources
  ) {
    this.subscriptions = [inbox.onDidChangeTreeData(() => this.refresh())];
  }

  /** Whether Home is open. */
  get isOpen(): boolean {
    return !!this.panel;
  }

  /** Shows Home alone in the main column, with the focus, and its lists afresh. */
  show(): Promise<void> {
    if (this.panel) this.panel.reveal();
    else {
      this.panel = new HomePanel(
        this.state,
        vscode.Uri.file(this.avatars.dir),
        (action) => this.act(action)
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
    }
    return this.update();
  }

  /** Closes Home, as a Change comes to the front; Show Home brings it back. */
  close(): void {
    this.panel?.dispose();
  }

  /** Shows the lists afresh soon, once a burst of changes has passed. */
  refresh(): void {
    if (!this.panel) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.update(), 50);
  }

  /** The panel, for the tests. */
  panels(): HomePanel[] {
    return this.panel ? [this.panel] : [];
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.panel?.dispose();
    for (const subscription of this.subscriptions) subscription.dispose();
  }

  /**
   * Sends the panel the open Changes and what the Inbox lists: first with
   * the Inbox's last load, marked loading, and again once the latest is in.
   */
  private async update(): Promise<void> {
    const thisUpdate = ++this.latest;
    const contents = this.inbox.contents();
    this.send(await this.build(this.lastContents, true), thisUpdate);
    try {
      this.lastContents = await contents;
    } catch {
      // The Inbox shows its own problem; Home keeps its last lists.
    }
    this.send(await this.build(this.lastContents, false), thisUpdate);
  }

  private send(
    { state, targets }: { state: HomeState; targets: Targets },
    thisUpdate: number
  ): void {
    if (thisUpdate !== this.latest || !this.panel) return;
    this.state = state;
    this.targets = targets;
    this.panel.update(state);
  }

  private async build(
    contents: { groups: InboxNode[]; welcome: Welcome } | undefined,
    loading: boolean
  ): Promise<{ state: HomeState; targets: Targets }> {
    const now = Date.now();
    const targets = emptyTargets();
    const changes = this.sources.inProgress();
    const groups = contents?.groups ?? [];
    const pullRequests = groups.flatMap((g) =>
      g.kind === "group" ? g.children : []
    );
    const summaryOf = (change: Change) =>
      change.pullRequest &&
      pullRequests.find(
        (n): n is Extract<InboxNode, { kind: "pullRequest" }> =>
          n.kind === "pullRequest" &&
          n.pullRequest.repository.toLowerCase() ===
            change.pullRequest!.repository.toLowerCase() &&
          n.pullRequest.number === change.pullRequest!.number
      )?.pullRequest;
    const standings = await Promise.all(
      changes.map((change) => this.sources.standing(change))
    );
    for (const change of changes) targets.changes.set(change.id, change);
    const inProgress: HomeChange[] = changes.map((change, i) => {
      const standing = standings[i];
      const summary = summaryOf(change);
      return {
        id: change.id,
        title: summary?.title ?? changeName(change),
        byline: bylineOf(change, summary),
        ...(standing.review && { review: standing.review }),
        standing: standing.notes,
        finish: change.pullRequest ? "Submit Review…" : "Write Brief…",
      };
    });

    const group = (label: string) =>
      groups.find(
        (g): g is Extract<InboxNode, { kind: "group" }> =>
          g.kind === "group" && g.label === label
      );
    const awaiting = group(awaitingMyReview);
    const authored = group(authoredByMe);
    const local = group("Local branches");
    const waitingNodes = byLongestWait(
      (awaiting?.children ?? []).flatMap((node) =>
        node.kind === "pullRequest"
          ? [{ node, since: waitingSince(node.pullRequest) }]
          : []
      )
    );
    const waiting = awaiting
      ? await Promise.all(
          waitingNodes.map(({ node, since }) =>
            this.pullRequest(targets, node, waitedFor(since, now))
          )
        )
      : undefined;
    const authoredRows = authored
      ? await Promise.all(
          authored.children.flatMap((node) =>
            node.kind === "pullRequest" ? [this.pullRequest(targets, node)] : []
          )
        )
      : undefined;
    const branches: HomeBranch[] = [];
    const branchProblems: HomeProblem[] = [];
    for (const node of local?.children ?? []) {
      if (node.kind === "problem")
        branchProblems.push(
          problemOf(targets, node, `branches ${branchProblems.length}`)
        );
      if (node.kind !== "localBranch") continue;
      const { branch } = node;
      const id = `branch ${branch.clone} ${branch.name}`;
      targets.nodes.set(id, node);
      branches.push({
        id,
        name: branch.name,
        repository: branch.repository,
        ahead: `${branch.commitsAhead} commit${branch.commitsAhead === 1 ? "" : "s"} ahead of ${branchName(branch.main)}`,
        notes: this.inbox.openState(node),
      });
    }
    const problems = groups.flatMap((node, i) =>
      node.kind === "problem" ? [problemOf(targets, node, `${i}`)] : []
    );
    const setup = setupFor(targets, contents?.welcome ?? "none");
    const next = nextStep(
      changes.map((change, i) => ({
        id: change.id,
        name: changeName(change),
        reviewed: standings[i].reviewed,
        pending: standings[i].pending,
        viewed: standings[i].viewed,
        total: standings[i].total,
        finish: inProgress[i].finish,
      })),
      waitingNodes.map(({ node, since }) => ({
        id: pullRequestId(node.pullRequest),
        name: pullRequestName(node.pullRequest),
        since,
        open: this.inbox.openState(node).length > 0,
      })),
      now
    );
    const state: HomeState = {
      facts: homeFacts(
        changes.length,
        waiting && waitingNodes.map(({ since }) => ({ since })),
        now
      ),
      ...(next && { next }),
      inProgress,
      ...(waiting && { waiting }),
      ...(authoredRows && { authored: authoredRows }),
      branches,
      loading,
      ...(setup && { setup }),
      problems,
      branchProblems,
    };
    return { state, targets };
  }

  private async pullRequest(
    targets: Targets,
    node: Extract<InboxNode, { kind: "pullRequest" }>,
    waited?: string
  ): Promise<HomePullRequest> {
    const pr = node.pullRequest;
    const id = pullRequestId(pr);
    targets.nodes.set(id, node);
    const avatar =
      waited !== undefined && (await this.avatars.file(pr.author.avatarUrl));
    const states = node.authoredByMe
      ? authoredStates(pr)
          // The checks already say when they failed.
          .filter((state) => state !== "checksFailed")
          .map((state) => authoredStateLook(state, pr).description)
      : [];
    const changedSinceReview =
      pr.lastReviewedSha !== undefined && pr.lastReviewedSha !== pr.headSha;
    return {
      id,
      title: pr.title,
      name: pullRequestName(pr),
      author: pr.author.login,
      ...(avatar && this.panel && { avatar: this.panel.webviewUri(avatar) }),
      ...(waited !== undefined && { waited }),
      size: pr.size,
      ...(pr.checks && { checks: pr.checks }),
      notes: [
        ...states,
        ...(changedSinceReview ? ["new commits since your Review"] : []),
        ...this.inbox.openState(node),
      ],
    };
  }

  private act(action: HomeAction): void {
    if (action.type === "refresh") return this.sources.refresh();
    if (action.type === "next") {
      const next = this.state.next;
      if (next) this.act({ type: next.kind, id: next.id });
      return;
    }
    if (action.type === "fix") {
      const command = this.targets.commands.get(action.id);
      if (command)
        void vscode.commands.executeCommand(
          command.command,
          ...(command.arguments ?? [])
        );
      return;
    }
    const change = this.targets.changes.get(action.id);
    if (action.type === "resume" && change) this.sources.resume(change);
    else if (action.type === "finish" && change) this.sources.finish(change);
    else if (action.type === "open") {
      const node = this.targets.nodes.get(action.id);
      if (node) this.sources.open(node);
      else if (change) this.sources.resume(change);
    }
  }
}

export type { FromHome, HomeState };

/** What Home's buttons act on, by the id the webview names them by. */
interface Targets {
  changes: Map<string, Change>;
  nodes: Map<string, InboxNode>;
  commands: Map<string, vscode.Command>;
}

function emptyTargets(): Targets {
  return { changes: new Map(), nodes: new Map(), commands: new Map() };
}

function problemOf(
  targets: Targets,
  node: Extract<InboxNode, { kind: "problem" }>,
  key: string
): HomeProblem {
  const id = `problem ${key}`;
  if (node.action) targets.commands.set(id, node.action);
  return {
    id,
    text: node.message,
    ...(node.action && { action: node.action.title }),
  };
}

/** What to set up before GitHub's pull requests can be listed. */
function setupFor(targets: Targets, welcome: Welcome): HomeProblem | undefined {
  if (welcome === "none") return;
  const { command, ...setup } = setups[welcome];
  targets.commands.set(setup.id, { title: setup.action, command });
  return setup;
}

const setups: Record<
  Exclude<Welcome, "none">,
  HomeProblem & { action: string; command: string }
> = {
  signedOut: {
    id: "signIn",
    text: "Sign in to GitHub to list the pull requests waiting on you.",
    action: "Sign In to GitHub",
    command: "dearReviewer.signIn",
  },
  noRepositories: {
    id: "addRepository",
    text: "Add a repository to list its pull requests and branches here.",
    action: "Add Repository…",
    command: "dearReviewer.addRepository",
  },
};

/** When the pull request started waiting on the Reviewer: its review request, or else its creation. */
function waitingSince(pr: PullRequestSummary): string {
  return pr.reviewRequestedAt ?? pr.createdAt;
}

/** A ref's branch name, such as `main` for `refs/remotes/upstream/main`. */
function branchName(ref: string): string {
  return ref.replace(/^refs\/(?:heads|remotes\/[^/]+)\//, "");
}

function pullRequestId(pr: { repository: string; number: number }): string {
  return conversationName({ kind: "pullRequest", pullRequest: pr });
}

/** `acme/api #7 · alice → main`, or a local Change's branch or commits and repository. */
function bylineOf(change: Change, summary?: PullRequestSummary): string {
  if (change.pullRequest) {
    const name = pullRequestName(change.pullRequest);
    return summary
      ? `${name} · ${summary.author.login} → ${summary.baseRefName}`
      : name;
  }
  const repo = path.basename(change.repository);
  return branchOfConversation(change.conversation)
    ? `local branch in ${repo}`
    : repo;
}

function emptyState(): HomeState {
  return {
    facts: "",
    inProgress: [],
    branches: [],
    loading: true,
    problems: [],
    branchProblems: [],
  };
}
