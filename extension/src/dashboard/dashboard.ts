// The Dashboard (ADR 0032): the Dear Reviewer side bar in the Reviewer's own
// windows, where they see where they stand across their Changes and start
// the next review. Its lists come from the Inbox's own load and the
// overview's standing, so the Dashboard and the overview never disagree, and
// it shows them afresh whenever those change while it's in sight.

import * as path from "path";
import * as vscode from "vscode";
import { authoredStateLook, authoredStates } from "../authoredStates";
import { changeName, pullRequestName, type Change } from "../changeWorkspace";
import { branchOfConversation, conversationName } from "../conversationName";
import type { PullRequestSummary } from "../github/client";
import {
  authoredByMe,
  awaitingMyReview,
  reviewedByMe,
  type Avatars,
  type InboxNode,
  type InboxTree,
  type Welcome,
} from "../inbox";
import type { Standing } from "../timeline/timelines";
import {
  byLongestWait,
  dashboardFacts,
  nextStep,
  waitedFor,
} from "./dashboardState";
import {
  DashboardView,
  type DashboardAction,
  type DashboardBranch,
  type DashboardChange,
  type DashboardProblem,
  type DashboardPullRequest,
  type DashboardSetup,
  type DashboardState,
  type FromDashboard,
} from "./view";

/** What the Dashboard learns from the rest of Dear Reviewer, and how it acts. */
export interface DashboardSources {
  /** The Changes open in any window, the one shown last last. */
  inProgress(): Change[];
  /** Where the Reviewer stands on the Change. */
  standing(change: Change): Promise<Standing>;
  /** How many of the Change's files are viewed, of how many, from git alone. */
  viewedCount(change: Change): Promise<{ viewed: number; total: number }>;
  /** Brings the Change to the front in the review window, with its overview. */
  resume(change: Change): void;
  /** Starts finishing the Change's Review there: Submit Review… or Write Brief…. */
  finish(change: Change): void;
  /** Closes the Change, in whichever window shows it. */
  close(change: Change): void;
  /** Opens the Inbox's pull request or branch as a Change. */
  open(node: InboxNode): void;
  /** Asks for any commit range of a repository to open as a Change. */
  openRange(): void;
  /** Whether the window trusts its folders, so their repositories are read. */
  trusted(): boolean;
}

export class Dashboard implements vscode.Disposable {
  private readonly view: DashboardView;
  private state: DashboardState = emptyState();
  /** What the Dashboard's buttons act on, by the id the webview names them by. */
  private targets = emptyTargets();
  private timer?: NodeJS.Timeout;
  /** The Inbox's latest load, once one is in. */
  private lastContents?: { groups: InboxNode[]; welcome: Welcome };
  /** The number of the update started last; earlier ones don't show. */
  private latest = 0;
  /**
   * Each open Change's standing, as last worked out. Its last Review and
   * pending Comments can come from GitHub, so In progress never waits for
   * them: it shows the last standing, or what git alone tells, and again
   * once a newer standing is in.
   */
  private readonly standings = new Map<string, Standing>();
  private readonly asking = new Set<string>();
  private readonly subscriptions: vscode.Disposable[];

  constructor(
    private readonly inbox: InboxTree,
    private readonly avatars: Avatars,
    private readonly sources: DashboardSources
  ) {
    this.view = new DashboardView(
      this.state,
      vscode.Uri.file(avatars.dir),
      (action) => this.act(action)
    );
    this.subscriptions = [
      this.view,
      vscode.window.registerWebviewViewProvider(
        DashboardView.viewType,
        this.view,
        { webviewOptions: { retainContextWhenHidden: true } }
      ),
      this.view.onDidShow(() => void this.update()),
      inbox.onDidChangeTreeData(() => this.refresh()),
    ];
  }

  /** Shows the Dear Reviewer side bar with the Dashboard, its next step taking the focus. */
  async show(): Promise<void> {
    await vscode.commands.executeCommand(`${DashboardView.viewType}.focus`);
    this.view.focus();
  }

  /** Shows the lists afresh soon, while the Dashboard is in sight, once a burst of changes has passed. */
  refresh(): void {
    if (!this.view.visible) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.update(), 50);
  }

  /** The view, for the tests. */
  views(): DashboardView[] {
    return [this.view];
  }

  dispose(): void {
    clearTimeout(this.timer);
    for (const subscription of this.subscriptions) subscription.dispose();
  }

  /**
   * Sends the view the open Changes and what the Inbox lists: first with
   * the Inbox's last load, marked loading, and again once the latest is in.
   */
  private async update(): Promise<void> {
    const thisUpdate = ++this.latest;
    const contents = this.inbox.contents();
    this.send(await this.build(this.lastContents, true), thisUpdate);
    try {
      this.lastContents = await contents;
    } catch {
      // The Inbox's problems are in its groups; the Dashboard keeps its last lists.
    }
    this.send(await this.build(this.lastContents, false), thisUpdate);
  }

  /** The Change's standing as last worked out, asking for it afresh. */
  private async standingOf(change: Change): Promise<Standing> {
    if (!this.asking.has(change.id)) {
      this.asking.add(change.id);
      this.sources.standing(change).then(
        (standing) => {
          this.asking.delete(change.id);
          const last = this.standings.get(change.id);
          this.standings.set(change.id, standing);
          if (JSON.stringify(last) !== JSON.stringify(standing)) this.refresh();
        },
        () => this.asking.delete(change.id)
      );
    }
    const last = this.standings.get(change.id);
    if (last) return last;
    const { viewed, total } = await this.sources
      .viewedCount(change)
      .catch(() => ({ viewed: 0, total: -1 }));
    return {
      notes: total < 0 ? [] : [`${viewed} of ${total} viewed`],
      viewed,
      total,
      reviewed: false,
      pending: 0,
    };
  }

  private send(
    { state, targets }: { state: DashboardState; targets: Targets },
    thisUpdate: number
  ): void {
    if (thisUpdate !== this.latest) return;
    this.state = state;
    this.targets = targets;
    this.view.update(state);
  }

  private async build(
    contents: { groups: InboxNode[]; welcome: Welcome } | undefined,
    loading: boolean
  ): Promise<{ state: DashboardState; targets: Targets }> {
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
      changes.map((change) => this.standingOf(change))
    );
    for (const id of this.standings.keys())
      if (!changes.some((change) => change.id === id))
        this.standings.delete(id);
    for (const change of changes) targets.changes.set(change.id, change);
    const inProgress: DashboardChange[] = changes.map((change, i) => {
      const standing = standings[i];
      const summary = summaryOf(change);
      return {
        id: change.id,
        title: summary?.title ?? changeName(change),
        byline: bylineOf(change, summary),
        ...(standing.review && { review: standing.review }),
        standing:
          standing.total === 0
            ? [...standing.notes.slice(0, -1), "Nothing to review"]
            : standing.notes,
        end:
          standing.total === 0
            ? { type: "close", label: "Close Change" }
            : {
                type: "finish",
                label: change.pullRequest ? "Submit Review…" : "Write Brief…",
              },
      };
    });

    const group = (label: string) =>
      groups.find(
        (g): g is Extract<InboxNode, { kind: "group" }> =>
          g.kind === "group" && g.label === label
      );
    const awaiting = group(awaitingMyReview);
    const authored = group(authoredByMe);
    const reviewed = group(reviewedByMe);
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
    const reviewedRows = reviewed
      ? await Promise.all(
          reviewed.children.flatMap((node) =>
            node.kind === "pullRequest" ? [this.pullRequest(targets, node)] : []
          )
        )
      : undefined;
    const branches: DashboardBranch[] = [];
    const branchProblems: DashboardProblem[] = [];
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
    const setup = setupFor(
      targets,
      contents?.welcome ?? "none",
      this.sources.trusted()
    );
    const next = nextStep(
      changes.map((change, i) => ({
        id: change.id,
        name: changeName(change),
        reviewed: standings[i].reviewed,
        pending: standings[i].pending,
        viewed: standings[i].viewed,
        total: standings[i].total,
        finish: inProgress[i].end.label,
      })),
      waitingNodes.map(({ node, since }) => ({
        id: pullRequestId(node.pullRequest),
        name: pullRequestName(node.pullRequest),
        since,
        open: this.inbox.openState(node).length > 0,
      })),
      now
    );
    const state: DashboardState = {
      ...(waiting && {
        facts: dashboardFacts(
          waitingNodes.map(({ since }) => ({ since })),
          now
        ),
      }),
      ...(next && { next }),
      // The Change shown last first, as the next step resumes it.
      inProgress: [...inProgress].reverse(),
      ...(waiting && { waiting }),
      ...(authoredRows && { authored: authoredRows }),
      ...(reviewedRows && { reviewed: reviewedRows }),
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
  ): Promise<DashboardPullRequest> {
    const pr = node.pullRequest;
    const id = pullRequestId(pr);
    targets.nodes.set(id, node);
    const avatarFile =
      waited !== undefined && (await this.avatars.file(pr.author.avatarUrl));
    const avatar = avatarFile && this.view.webviewUri(avatarFile);
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
      ...(avatar && { avatar }),
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

  private act(action: DashboardAction): void {
    if (action.type === "openRange") return this.sources.openRange();
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
    else if (action.type === "close" && change) this.sources.close(change);
    else if (action.type === "open") {
      const node = this.targets.nodes.get(action.id);
      if (node) this.sources.open(node);
      else if (change) this.sources.resume(change);
    }
  }
}

export type { DashboardState, FromDashboard };

/** What the Dashboard's buttons act on, by the id the webview names them by. */
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
): DashboardProblem {
  const id = `problem ${key}`;
  if (node.action) targets.commands.set(id, node.action);
  return {
    id,
    text: node.message,
    ...(node.action && { action: node.action.title }),
  };
}

/** What to set up before GitHub's pull requests can be listed, and the links that help. */
function setupFor(
  targets: Targets,
  welcome: Welcome,
  trusted: boolean
): DashboardSetup | undefined {
  if (welcome === "none") return;
  const setup =
    welcome === "noRepositories" && !trusted
      ? setups.untrusted
      : setups[welcome];
  for (const action of setup.actions)
    targets.commands.set(action.id, {
      title: action.label,
      command: action.command,
      ...(action.arguments && { arguments: action.arguments }),
    });
  return {
    text: setup.text,
    actions: setup.actions.map(({ id, label }) => ({ id, label })),
  };
}

interface SetupLink {
  id: string;
  label: string;
  command: string;
  arguments?: unknown[];
}

const setUpStepByStep: SetupLink = {
  id: "openSetup",
  label: "Set Up Dear Reviewer",
  command: "dearReviewer.openSetup",
};

const setups: Record<
  Exclude<Welcome, "none"> | "untrusted",
  { text: string; actions: SetupLink[] }
> = {
  signedOut: {
    text: "Sign in to GitHub to list the pull requests waiting on you and the ones you authored.",
    actions: [
      {
        id: "signIn",
        label: "Sign In to GitHub",
        command: "dearReviewer.signIn",
      },
      {
        id: "setToken",
        label: "Use a Personal Access Token",
        command: "dearReviewer.setToken",
      },
      setUpStepByStep,
    ],
  },
  noRepositories: {
    text: "The Dashboard lists pull requests from the GitHub repositories you have open in your windows. Open a clone of one, or add a clone from elsewhere on this machine.",
    actions: [
      {
        id: "addRepository",
        label: "Add Repository…",
        command: "dearReviewer.addRepository",
      },
      { id: "openFolder", label: "Open Folder…", command: "vscode.openFolder" },
      {
        id: "repositoriesSetting",
        label: "Repositories Setting",
        command: "workbench.action.openSettings",
        arguments: ["dearReviewer.repositories"],
      },
      setUpStepByStep,
    ],
  },
  untrusted: {
    text: "This window is in Restricted Mode, so Dear Reviewer doesn't read the repositories of its folders.",
    actions: [
      {
        id: "manageTrust",
        label: "Manage Workspace Trust",
        command: "workbench.trust.manage",
      },
      {
        id: "addRepository",
        label: "Add Repository…",
        command: "dearReviewer.addRepository",
      },
    ],
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

function emptyState(): DashboardState {
  return {
    inProgress: [],
    branches: [],
    loading: true,
    problems: [],
    branchProblems: [],
  };
}
