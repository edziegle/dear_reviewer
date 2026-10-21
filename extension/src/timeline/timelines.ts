// The overview of each Change shown in this window (ADR 0019): one panel per
// Change, opened alone in the main column when the Change opens, which
// orients the Reviewer before they read; their code then opens beside it
// (ADR 0020). It shows what the Change is, its size, where the Reviewer
// stands on it, the Assistant's short take and its Reading Order (ADR 0022),
// then its history: a pull request's timeline, loaded from GitHub, or a local
// Change's commits, from git. A pull request's Review ends in its Submit step
// (ADR 0033). Links in the panel open through the
// extension, and only the ones it sent; `path:line` references open only
// the Change's own files.

import * as path from "path";
import * as vscode from "vscode";
import {
  changedFiles,
  changeName,
  pullRequestName,
  type Change,
} from "../changeWorkspace";
import { branchOfConversation } from "../conversationName";
import { git } from "../git";
import type { CheckedFile } from "../unhighlighted";
import {
  GitHubClient,
  NotSignedInError,
  type GitHubUser,
  type PullRequestTimeline,
} from "../github/client";
import type { Avatars } from "../inbox";
import { openReference } from "../references";
import {
  TimelinePanel,
  type OverviewAction,
  type OverviewTake,
  type ReviewStanding,
  type StandingNote,
  type TimelineItem,
  type TimelineState,
} from "./panel";
import { isUnreachable, messageOf } from "../errors";
import type { ShownReadingOrder } from "../readingOrder";
import type { PendingCommentLine } from "../reviewComments";
import type { BriefState } from "../briefs";
import { checksInOrder } from "../checkRuns";
import {
  refusalOf,
  summaryNeeded,
  verdicts,
  verdictsFor,
  type Verdict,
} from "../reviewSubmission";

const signIn = "Sign In to GitHub";

export type LinkOpener = (uri: vscode.Uri) => Thenable<unknown>;

/** Where the Reviewer stands on a Change. */
export interface Standing {
  /** Their last Review's verdict, while no new commits came since. */
  review?: ReviewStanding;
  /** New commits since their Review, pending Comments, files viewed, in words. */
  notes: StandingNote[];
  viewed: number;
  total: number;
  /** Whether their last Review covers the Change's head, so nothing is new since. */
  reviewed: boolean;
  /** How many of their Comments are pending. */
  pending: number;
}

/** What the overview learns from the rest of Dear Reviewer, and how it acts. */
export interface OverviewSources {
  /** Where the Reviewer stands on the Change. */
  standing(change: Change): Promise<Standing>;
  /** Tells the pull request's title, once it has loaded. */
  titleLoaded(change: Change, title: string): void;
  /** The title the Change's tab shows: its pull request's, once that has loaded. */
  heading(change: Change): string;
  /** Whether the review window is untrusted, so code navigation is off in it. */
  navigationOff(): boolean;
  /** What the Change's Assistant has to show, once it has started. */
  take(change: Change): OverviewTake | undefined;
  /** The Change's Reading Order, with each file's viewed state. */
  readingOrder(change: Change): Promise<ShownReadingOrder | undefined>;
  /** Opens the diff of one of the Change's files. */
  openFile(change: Change, path: string): void;
  /** The file extensions among these files that no installed language highlights, unless dismissed. */
  unhighlighted(files: readonly CheckedFile[]): string[];
  /** Opens the Extensions view with a search for the file extension. */
  findExtension(extension: string): void;
  /** Never offers these file extensions again. */
  dismissUnhighlighted(extensions: string[]): void;
  /** The Change's Comments in the Review under way. */
  pendingComments(change: Change): PendingCommentLine[];
  /** Where a local Change's Brief stands. */
  brief(change: Change): BriefState | undefined;
  /** Shows one of them in the diff, by its place in that list. */
  openPending(change: Change, index: number): void;
  /**
   * Submits the Change's Review. Gives what it published, in words, and its
   * page on GitHub; throws if GitHub didn't take it.
   */
  submit(
    change: Change,
    verdict: Verdict,
    summary: string
  ): Promise<{ text: string; url?: string }>;
  /** Runs an action the overview offers for the Change. */
  act(
    change: Change,
    action:
      | "finish"
      | "nextFile"
      | "ask"
      | "codeFlow"
      | "showChangesSince"
      | "takeAction"
      | "takeRetry"
      | "trust"
      | "closeChange"
      | "copyBrief"
      | "showBrief"
      | "discard"
      | "suggestReadingOrder"
  ): void;
}

export class Timelines implements vscode.Disposable {
  private readonly byChange = new Map<string, ChangeTimeline>();

  constructor(
    private readonly github: GitHubClient,
    private readonly avatars: Avatars,
    private readonly openLink: LinkOpener,
    private readonly sources: OverviewSources
  ) {}

  /**
   * Shows the Change's overview and reloads it; with `focus`, gives it the
   * focus. Settles once the overview is ready. VS Code may still hand the
   * overview the focus a moment later, from an editor opened since: its
   * webview reports gaining the focus on a timer.
   */
  async open(change: Change, focus = false): Promise<void> {
    let timeline = this.byChange.get(change.id);
    if (!timeline) {
      timeline = new ChangeTimeline(
        change,
        this.github,
        this.avatars,
        this.openLink,
        this.sources
      );
      this.byChange.set(change.id, timeline);
    }
    timeline.show(focus);
    await Promise.all([timeline.load(), timeline.panel?.ready]);
  }

  /**
   * The column the Change's code opens in: beside its overview while the
   * overview holds the first column, or else the first.
   */
  codeColumn(change: Change): vscode.ViewColumn {
    return this.byChange.get(change.id)?.codeColumn() ?? vscode.ViewColumn.One;
  }

  /** Closes the overviews of every Change but this one; Show Overview brings them back. */
  closeOthers(change: Change): void {
    for (const [id, timeline] of this.byChange)
      if (id !== change.id) timeline.panel?.dispose();
  }

  /**
   * Shows the pull request's overview with the Submit step open and the
   * focus on its verdict, starting from this one if given.
   */
  async submit(change: Change, verdict?: Verdict): Promise<void> {
    let timeline = this.byChange.get(change.id);
    const opened = !timeline?.panel;
    if (!timeline) {
      timeline = new ChangeTimeline(
        change,
        this.github,
        this.avatars,
        this.openLink,
        this.sources
      );
      this.byChange.set(change.id, timeline);
    }
    timeline.show(true);
    timeline.openSubmit(verdict);
    if (opened) await timeline.load();
  }

  /**
   * Brings the Change's overview forward, with the focus on its finishing
   * button, the next step once every file is viewed.
   */
  async finish(change: Change): Promise<void> {
    await this.open(change, true);
    this.byChange.get(change.id)?.askFinish();
  }

  /** The pull request's page on GitHub, once the Change's overview has loaded it. */
  pullRequestUrl(change: Change): string | undefined {
    return this.byChange.get(change.id)?.url;
  }

  /** Reloads the Change's overview, if it has one. */
  async refresh(change: Change): Promise<void> {
    await this.byChange.get(change.id)?.load();
  }

  /** Reloads every overview, such as after signing in. */
  async refreshAll(): Promise<void> {
    await Promise.all([...this.byChange.values()].map((t) => t.load()));
  }

  /** Shows afresh where the Reviewer stands, in every overview. */
  async refreshStanding(): Promise<void> {
    await Promise.all([...this.byChange.values()].map((t) => t.showStanding()));
  }

  /** Shows afresh, in every overview, which file extensions no installed language highlights. */
  refreshUnhighlighted(): void {
    for (const timeline of this.byChange.values()) timeline.showUnhighlighted();
  }

  /** Shows afresh what the Assistant of the Change with this conversation name has to show. */
  refreshTake(conversation: string): void {
    for (const timeline of this.byChange.values())
      if (timeline.change.conversation === conversation) timeline.showTake();
  }

  close(change: Change): void {
    this.byChange.get(change.id)?.dispose();
    this.byChange.delete(change.id);
  }

  /** The id of the Change whose overview the Reviewer is looking at, if any. */
  activeChangeId(): string | undefined {
    for (const [id, timeline] of this.byChange)
      if (timeline.panel?.active) return id;
  }

  /** Each open panel, for the tests. */
  panels(): TimelinePanel[] {
    return [...this.byChange.values()].flatMap((t) => t.panel ?? []);
  }

  dispose(): void {
    for (const timeline of this.byChange.values()) timeline.dispose();
    this.byChange.clear();
  }
}

class ChangeTimeline {
  private state: TimelineState;
  panel?: TimelinePanel;
  private loads = 0;
  /** How many times the Reviewer asked for the Submit step. */
  private asked = 0;
  /** How many times the Reviewer was brought here to finish. */
  private finishAsked = 0;
  /** Whether the Reviewer wrote the pull request, once its timeline says. */
  private ownPullRequest = false;
  /** The Change's files, whose `path:line` references in the take open them. */
  private files = new Set<string>();
  /** The Change's files, with which are binary, once counted. */
  private checked: CheckedFile[] = [];

  constructor(
    readonly change: Change,
    private readonly github: GitHubClient,
    private readonly avatars: Avatars,
    private readonly openLink: LinkOpener,
    private readonly sources: OverviewSources
  ) {
    this.state = {
      title: changeName(change),
      byline: bylineOf(change),
      standing: [],
      take: this.take(),
      finish: change.pullRequest ? "Submit Review…" : "Write Brief…",
      history: change.pullRequest ? "Timeline" : "Commits",
      loading: true,
      items: [],
    };
  }

  /** The pull request's page on GitHub, once the overview has loaded it. */
  get url(): string | undefined {
    return this.state.url;
  }

  show(focus = false): void {
    if (this.panel) return this.panel.reveal(focus);
    const panel = new TimelinePanel(
      this.state,
      changeName(this.change),
      vscode.Uri.file(this.avatars.dir),
      (file) => this.files.has(file),
      (action) => this.act(action),
      focus
    );
    panel.onDidDispose(() => {
      if (this.panel === panel) this.panel = undefined;
    });
    this.panel = panel;
    panel.label(this.sources.heading(this.change));
  }

  /**
   * Reloads while the panel is open; showing it again reloads it. A later
   * load wins over one still under way. A pull request's history comes from
   * GitHub, whose problems leave the rest of the overview be.
   */
  async load(): Promise<void> {
    const panel = this.panel;
    if (!panel) return;
    const load = ++this.loads;
    this.update({ loading: true });
    const [size] = await Promise.all([
      this.size().catch(() => undefined),
      this.showStanding(),
    ]);
    if (load !== this.loads) return;
    if (size) this.update({ size });
    this.showUnhighlighted();
    try {
      const found = this.change.pullRequest
        ? await this.pullRequestState(panel)
        : await this.localState();
      if (load === this.loads) {
        this.update(found, true);
        if (this.change.pullRequest && found.title)
          this.sources.titleLoaded(this.change, found.title);
        this.panel?.label(this.sources.heading(this.change));
      }
    } catch (err) {
      if (load !== this.loads) return;
      const signedOut = err instanceof NotSignedInError;
      const history = this.state.history.toLowerCase();
      const problem = signedOut
        ? "Sign in to GitHub to see the timeline."
        : isUnreachable(err)
          ? `Couldn't reach GitHub to load the ${history}. Check the connection, then retry.`
          : `Couldn't load the ${history}: ${messageOf(err)}`;
      this.update({
        loading: false,
        problem,
        problemAction: signedOut ? signIn : "Retry",
      });
    }
  }

  async showStanding(): Promise<void> {
    if (!this.panel) return;
    const [found, readingOrder] = await Promise.all([
      this.sources.standing(this.change).catch(() => undefined),
      this.sources.readingOrder(this.change).catch(() => undefined),
    ]);
    this.update({
      ...(this.state.submit && { submit: this.pendingOf(this.state.submit) }),
      // New commits begin the Review again, so its result no longer holds.
      ...(found && !found.reviewed && { submitted: undefined }),
      brief: this.sources.brief(this.change),
      readingOrder,
      standing: found?.notes ?? [],
      review: found?.review,
      navigationOff: this.sources.navigationOff(),
      ...(found && { progress: { viewed: found.viewed, total: found.total } }),
      pending: found?.pending,
      finished: !!found?.reviewed && found.pending === 0,
    });
  }

  /** Beside the overview while it holds the first column, or else the first. */
  codeColumn(): vscode.ViewColumn {
    return this.panel?.viewColumn === vscode.ViewColumn.One
      ? vscode.ViewColumn.Two
      : vscode.ViewColumn.One;
  }

  /** Offers to find an extension for the file extensions no installed language highlights, while any remain. */
  showUnhighlighted(): void {
    const extensions = this.sources.unhighlighted(this.checked);
    if (extensions.length) this.state.unhighlighted = extensions;
    else delete this.state.unhighlighted;
    this.panel?.update(this.state);
  }

  /** Asks the overview to put the focus on its finishing button. */
  askFinish(): void {
    this.update({ finishAsked: ++this.finishAsked });
  }

  /** Opens the Submit step, or brings the focus back to it, starting from the verdict given. */
  openSubmit(verdict?: Verdict): void {
    if (!this.change.pullRequest) return;
    const step = this.state.submit;
    this.update({
      submit: this.pendingOf({
        asked: ++this.asked,
        verdicts: [],
        needsSummary: {},
        comments: [],
        submitting: step?.submitting ?? false,
        ...(verdict && { verdict }),
      }),
      submitted: undefined,
    });
  }

  /**
   * The step with the verdicts GitHub takes on this pull request, the
   * Comments pending now, and what they let it take without a summary.
   */
  private pendingOf(
    step: NonNullable<TimelineState["submit"]>
  ): NonNullable<TimelineState["submit"]> {
    const comments = this.sources.pendingComments(this.change);
    const offered = verdictsFor(this.ownPullRequest);
    return {
      ...step,
      verdicts: offered.map((v) => ({
        verdict: v,
        label: verdicts[v].label,
        detail: verdicts[v].detail,
      })),
      note: this.ownPullRequest
        ? "On your own pull request, GitHub takes only a comment."
        : undefined,
      comments,
      needsSummary: summaryNeeded(comments.length),
    };
  }

  /** Submits the Review from the step, which says why if GitHub doesn't take it. */
  private async submitReview(verdict: Verdict, summary: string): Promise<void> {
    const step = this.state.submit;
    if (!step || step.submitting) return;
    if (!step.verdicts.some((v) => v.verdict === verdict)) return;
    const refused = !summary.trim() && step.needsSummary[verdict];
    if (refused) return this.update({ submit: { ...step, problem: refused } });
    this.update({
      submit: {
        ...step,
        submitting: true,
        problem: undefined,
        problemAction: undefined,
        problemDetail: undefined,
      },
    });
    try {
      const submitted = await this.sources.submit(
        this.change,
        verdict,
        summary
      );
      await this.showStanding();
      this.update({ submit: undefined, submitted });
      void this.load();
    } catch (err) {
      const now = this.state.submit;
      if (!now) return;
      const signedOut = err instanceof NotSignedInError;
      const refusal =
        signedOut || isUnreachable(err) ? undefined : refusalOf(messageOf(err));
      this.update({
        submit: {
          ...now,
          submitting: false,
          problem: signedOut
            ? "Sign in to GitHub to submit your Review; your draft stays here."
            : isUnreachable(err)
              ? "Couldn't reach GitHub to submit your Review. Check the connection, then submit again."
              : refusal!.text,
          problemAction: signedOut ? signIn : undefined,
          problemDetail: refusal?.detail,
        },
      });
    }
  }

  showTake(): void {
    this.update({ take: this.take() });
  }

  dispose(): void {
    this.loads++;
    this.panel?.dispose();
  }

  private take(): OverviewTake {
    return (
      this.sources.take(this.change) ?? { label: "Assistant", reading: true }
    );
  }

  private act(action: OverviewAction): void {
    switch (action.type) {
      case "openLink":
        return void this.open(action.url);
      case "openReference":
        // Only the Change's files, as the take showed them.
        if (!this.files.has(action.path)) return;
        void openReference(
          this.change,
          action.path,
          action.startLine,
          action.endLine,
          this.codeColumn()
        );
        return;
      case "openFile":
        // Only the Change's files, as the Reading Order listed them.
        if (this.files.has(action.path))
          this.sources.openFile(this.change, action.path);
        return;
      case "findExtension":
        // Only a file extension the overview offered.
        if (this.state.unhighlighted?.includes(action.extension))
          this.sources.findExtension(action.extension);
        return;
      case "dismissUnhighlighted":
        if (this.state.unhighlighted)
          this.sources.dismissUnhighlighted(this.state.unhighlighted);
        return;
      case "refresh":
        return void this.load();
      case "submit":
        return void this.submitReview(action.verdict, action.summary);
      case "submitAction":
        if (this.state.submit?.problemAction === signIn)
          void vscode.commands.executeCommand("dearReviewer.signIn");
        return;
      case "cancelSubmit":
        if (!this.state.submit?.submitting) this.update({ submit: undefined });
        return;
      case "openPending":
        this.sources.openPending(this.change, action.index);
        return;
      case "problemAction":
        if (this.state.problemAction === signIn)
          void vscode.commands.executeCommand("dearReviewer.signIn");
        else void this.load();
        return;
      default:
        this.sources.act(this.change, action.type);
    }
  }

  /** Opens a link the panel showed, in its header, checks or bodies, and nothing else it might ask for. */
  private async open(url: string): Promise<void> {
    const links = [
      this.state.url,
      this.state.submitted?.url,
      ...(this.state.checks?.runs.map((run) => run.url) ?? []),
    ];
    const sent = links.includes(url) || this.panel?.hasLink(url);
    if (!sent || !/^https?:\/\//i.test(url)) return;
    await this.openLink(vscode.Uri.parse(url, true));
  }

  /** The Change's files, and the lines they add and remove. */
  private async size(): Promise<TimelineState["size"]> {
    const files = await changedFiles(this.change);
    this.files = new Set(files.map((f) => f.path));
    const numstat = await git(
      this.change.repository,
      "diff",
      "--numstat",
      "-z",
      this.change.mergeBase,
      this.change.headSha
    );
    let additions = 0;
    let deletions = 0;
    const binary = new Set<string>();
    const fields = numstat.split("\0");
    for (let i = 0; i < fields.length; i++) {
      if (!fields[i]) continue;
      // A binary file counts "-" for both.
      const [added, deleted, name] = fields[i].split("\t");
      additions += Number(added) || 0;
      deletions += Number(deleted) || 0;
      // A renamed file's old and new paths follow in fields of their own.
      const file = name === "" ? fields[(i += 2)] : name;
      if (added === "-") binary.add(file);
    }
    this.checked = files.map((f) => ({
      path: f.path,
      binary: binary.has(f.path),
    }));
    return { files: files.length, additions, deletions };
  }

  private async pullRequestState(panel: TimelinePanel): Promise<TimelineState> {
    const { repository, number } = this.change.pullRequest!;
    const [timeline, viewer] = await Promise.all([
      this.github.timeline(repository, number),
      this.github.viewer().catch(() => undefined),
    ]);
    const opener = timeline.events.find((e) => e.kind === "description")?.author
      .login;
    const own = !!viewer && opener === viewer;
    if (own !== this.ownPullRequest) {
      this.ownPullRequest = own;
      if (this.state.submit)
        this.state = {
          ...this.state,
          submit: this.pendingOf(this.state.submit),
        };
    }
    const avatars = new Map<string, string | undefined>();
    const author = async (user: GitHubUser) => {
      if (!avatars.has(user.avatarUrl)) {
        const file = await this.avatars.file(user.avatarUrl);
        avatars.set(user.avatarUrl, file && panel.webviewUri(file));
      }
      const avatar = avatars.get(user.avatarUrl);
      return { login: user.login, ...(avatar && { avatar }) };
    };
    const items: TimelineItem[] = [];
    for (const event of timeline.events)
      items.push({ ...event, author: await author(event.author) });
    return {
      ...this.state,
      title: timeline.title,
      byline: pullRequestByline(this.change, timeline),
      url: timeline.url,
      loading: false,
      items,
      checks: timeline.checks && {
        ...timeline.checks,
        ...checksInOrder(timeline.checks.runs),
      },
    };
  }

  /** A local Change's commits, oldest first, by their authors. */
  private async localState(): Promise<TimelineState> {
    const log = await git(
      this.change.repository,
      "log",
      "--reverse",
      "--format=%h%x00%an%x00%aI%x00%s",
      `${this.change.mergeBase}..${this.change.headSha}`
    );
    const items: TimelineItem[] = log
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, name, date, headline] = line.split("\0");
        return {
          kind: "commit",
          author: { login: name },
          date,
          sha,
          headline,
        };
      });
    return {
      ...this.state,
      byline: bylineOf(this.change, items.length),
      loading: false,
      items,
      checks: undefined,
    };
  }

  private update(changes: Partial<TimelineState>, replace = false): void {
    this.state = replace
      ? (changes as TimelineState)
      : { ...this.state, ...changes };
    if (replace || changes.loading) {
      delete this.state.problem;
      delete this.state.problemAction;
    }
    this.panel?.update(this.state);
  }
}

/**
 * What the Change is, before anything is loaded: nothing more for a pull
 * request, whose name is the title until its own loads, or a local Change's
 * branch or commits and repository.
 */
function bylineOf(change: Change, commits?: number): string {
  if (change.pullRequest) return "";
  const repo = path.basename(change.repository);
  const branch = branchOfConversation(change.conversation);
  const count =
    commits === undefined
      ? []
      : [`${commits} commit${commits === 1 ? "" : "s"}`];
  return [branch ? `local branch in ${repo}` : repo, ...count].join(" · ");
}

/** `acme/api #7 · alice → main` */
function pullRequestByline(
  change: Change,
  timeline: PullRequestTimeline
): string {
  const author = timeline.events.find((e) => e.kind === "description")?.author
    .login;
  const where = author
    ? `${author} → ${timeline.baseRef}`
    : `into ${timeline.baseRef}`;
  return `${pullRequestName(change.pullRequest!)} · ${where}`;
}
