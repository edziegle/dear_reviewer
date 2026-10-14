// The timeline of each pull request Change shown in this window: one panel
// per Change, loaded from GitHub when the Change is shown and reloaded on
// request. Links in the panel open through the extension, and only the ones
// it sent.

import * as vscode from "vscode";
import type { Change, PullRequestRef } from "../changeWorkspace";
import {
  GitHubClient,
  NotSignedInError,
  type GitHubUser,
  type PullRequestTimeline,
} from "../github/client";
import type { Avatars } from "../inbox";
import { TimelinePanel, type TimelineState } from "./panel";

const signIn = "Sign In to GitHub";

export type LinkOpener = (uri: vscode.Uri) => Thenable<unknown>;

export class Timelines implements vscode.Disposable {
  private readonly byChange = new Map<string, ChangeTimeline>();

  constructor(
    private readonly github: GitHubClient,
    private readonly avatars: Avatars,
    private readonly openLink: LinkOpener
  ) {}

  /** Shows the timeline of a pull request Change and reloads it; a local Change has none. */
  async open(change: Change): Promise<void> {
    if (!change.pullRequest) return;
    let timeline = this.byChange.get(change.id);
    if (!timeline) {
      timeline = new ChangeTimeline(
        change.pullRequest,
        this.github,
        this.avatars,
        this.openLink
      );
      this.byChange.set(change.id, timeline);
    }
    timeline.show();
    await timeline.load();
  }

  /** Reloads the Change's timeline, if it has one. */
  async refresh(change: Change): Promise<void> {
    await this.byChange.get(change.id)?.load();
  }

  /** Reloads every timeline, such as after signing in. */
  async refreshAll(): Promise<void> {
    await Promise.all([...this.byChange.values()].map((t) => t.load()));
  }

  close(change: Change): void {
    this.byChange.get(change.id)?.dispose();
    this.byChange.delete(change.id);
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

  constructor(
    private readonly pullRequest: PullRequestRef,
    private readonly github: GitHubClient,
    private readonly avatars: Avatars,
    private readonly openLink: LinkOpener
  ) {
    const name = `${pullRequest.repository} #${pullRequest.number}`;
    this.state = { title: name, pullRequest: name, loading: true, items: [] };
  }

  show(): void {
    if (this.panel) return this.panel.reveal();
    const panel = new TimelinePanel(
      this.state,
      vscode.Uri.file(this.avatars.dir)
    );
    panel.onDidDispose(() => {
      if (this.panel === panel) this.panel = undefined;
    });
    panel.onDidClickLink((url) => void this.open(url));
    panel.onDidClickRefresh(() => void this.load());
    panel.onDidClickProblemAction(() => {
      if (this.state.problemAction === signIn)
        void vscode.commands.executeCommand("dearReviewer.signIn");
      else void this.load();
    });
    this.panel = panel;
  }

  /**
   * Reloads from GitHub while the panel is open; showing it again reloads
   * it. A later load wins over one still under way.
   */
  async load(): Promise<void> {
    const panel = this.panel;
    if (!panel) return;
    const load = ++this.loads;
    this.update({ loading: true });
    const { repository, number } = this.pullRequest;
    try {
      const timeline = await this.github.timeline(repository, number);
      const state = await this.stateOf(timeline, panel);
      if (load === this.loads) this.update(state, true);
    } catch (err) {
      if (load !== this.loads) return;
      const signedOut = err instanceof NotSignedInError;
      const problem = signedOut
        ? "Sign in to GitHub to see the timeline."
        : `Couldn't load the timeline: ${err instanceof Error ? err.message : String(err)}`;
      this.update({
        loading: false,
        problem,
        problemAction: signedOut ? signIn : "Retry",
      });
    }
  }

  dispose(): void {
    this.loads++;
    this.panel?.dispose();
  }

  /** Opens a link the panel showed, and nothing else it might ask for. */
  private async open(url: string): Promise<void> {
    const links = [
      this.state.url,
      ...(this.state.checks?.runs.map((run) => run.url) ?? []),
    ];
    if (!links.includes(url) || !/^https?:\/\//i.test(url)) return;
    await this.openLink(vscode.Uri.parse(url, true));
  }

  private async stateOf(
    timeline: PullRequestTimeline,
    panel: TimelinePanel
  ): Promise<TimelineState> {
    const avatars = new Map<string, string | undefined>();
    const author = async (user: GitHubUser) => {
      if (!avatars.has(user.avatarUrl)) {
        const file = await this.avatars.file(user.avatarUrl);
        avatars.set(user.avatarUrl, file && panel.webviewUri(file));
      }
      const avatar = avatars.get(user.avatarUrl);
      return { login: user.login, ...(avatar && { avatar }) };
    };
    const items: TimelineState["items"] = [];
    for (const event of timeline.events)
      items.push({ ...event, author: await author(event.author) });
    return {
      title: timeline.title,
      pullRequest: this.state.pullRequest,
      url: timeline.url,
      loading: false,
      items,
      ...(timeline.checks && { checks: timeline.checks }),
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
