// The overview of each Change shown in this window (ADR 0019): one panel per
// Change, opened beside the diff when the Change is shown, which orients the
// Reviewer before they read. It shows what the Change is, its size, where
// the Reviewer stands on it and the Assistant's short take, then its
// history: a pull request's timeline, loaded from GitHub, or a local
// Change's commits, from git. Links in the panel open through the
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
  type TimelineItem,
  type TimelineState,
} from "./panel";
import { messageOf } from "../errors";

const signIn = "Sign In to GitHub";

export type LinkOpener = (uri: vscode.Uri) => Thenable<unknown>;

/** What the overview learns from the rest of Dear Reviewer, and how it acts. */
export interface OverviewSources {
  /** Where the Reviewer stands on the Change: new commits since their Review, pending Comments, files viewed. */
  standing(change: Change): Promise<string[]>;
  /** What the Change's Assistant has to show, once it has started. */
  take(change: Change): OverviewTake | undefined;
  /** Runs an action the overview offers for the Change. */
  act(
    change: Change,
    action: "finish" | "nextFile" | "ask" | "takeAction"
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

  /** Shows the Change's overview and reloads it. */
  async open(change: Change): Promise<void> {
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
    timeline.show();
    await timeline.load();
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
  /** The Change's files, whose `path:line` references in the take open them. */
  private files = new Set<string>();

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

  show(): void {
    if (this.panel) return this.panel.reveal();
    const panel = new TimelinePanel(
      this.state,
      changeName(this.change),
      vscode.Uri.file(this.avatars.dir),
      (file) => this.files.has(file),
      (action) => this.act(action)
    );
    panel.onDidDispose(() => {
      if (this.panel === panel) this.panel = undefined;
    });
    this.panel = panel;
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
    try {
      const found = this.change.pullRequest
        ? await this.pullRequestState(panel)
        : await this.localState();
      if (load === this.loads) this.update(found, true);
    } catch (err) {
      if (load !== this.loads) return;
      const signedOut = err instanceof NotSignedInError;
      const problem = signedOut
        ? "Sign in to GitHub to see the timeline."
        : `Couldn't load the ${this.state.history.toLowerCase()}: ${messageOf(err)}`;
      this.update({
        loading: false,
        problem,
        problemAction: signedOut ? signIn : "Retry",
      });
    }
  }

  async showStanding(): Promise<void> {
    if (!this.panel) return;
    const standing = await this.sources.standing(this.change).catch(() => []);
    this.update({ standing });
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
        if (this.files.has(action.path))
          void openReference(
            this.change,
            action.path,
            action.startLine,
            action.endLine
          );
        return;
      case "refresh":
        return void this.load();
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
      this.change.mergeBase,
      this.change.headSha
    );
    let additions = 0;
    let deletions = 0;
    for (const line of numstat.split("\n")) {
      // A binary file counts "-" for both.
      const [added, deleted] = line.split("\t");
      additions += Number(added) || 0;
      deletions += Number(deleted) || 0;
    }
    return { files: files.length, additions, deletions };
  }

  private async pullRequestState(panel: TimelinePanel): Promise<TimelineState> {
    const { repository, number } = this.change.pullRequest!;
    const timeline = await this.github.timeline(repository, number);
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
      checks: timeline.checks,
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

/** What the Change is, before anything is loaded: its pull request, or its branch or commits and repository. */
function bylineOf(change: Change, commits?: number): string {
  if (change.pullRequest) return pullRequestName(change.pullRequest);
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
