// The Assistant for each Change shown in this window: one conversation per
// Change, and one view in the Secondary Side Bar where the Reviewer chats
// with the Assistant of the Change in front, once they ask (ADR 0038). A
// Change keeps its conversation across new commits and window reloads (ADR
// 0009): a new conversation starts with a short summary of what the Change
// does and where to start reading, which the Change's overview shows (ADR
// 0019), and a saved one carries on with `claude --resume`. When the Change
// has new commits since the Reviewer's last Review, the Assistant explains
// what changed, once for each such pair of commits, in the overview too (ADR
// 0015). At the end of a local Change's Review, it turns the Reviewer's
// Comments into a Brief in the same conversation (ADR 0016), and when the
// Reviewer asks, it raises Findings there too (ADR 0017). After the summary,
// it suggests a Reading Order for the Change's files, out of the view's
// sight, and again when the Reviewer asks (ADR 0022). It reads the Change's
// review threads from a file, and each message tells it where the Reviewer
// is reading (ADR 0023).

import * as fs from "fs";
import * as vscode from "vscode";
import { inTreeOrder } from "../changeFiles";
import {
  assistantDir,
  Change,
  changedFiles,
  changeName,
  changeSource,
  changeTitle,
} from "../changeWorkspace";
import type { LocalThread } from "../localReviews";
import { describeToolUse } from "./activity";
import {
  ClaudeCli,
  ClaudeConversation,
  ClaudeLogin,
  ClaudeProblem,
  findClaude,
  ToolUse,
} from "./claude";
import { Conversations, SavedConversation } from "./conversations";
import {
  AssistantView,
  ConversationState,
  FromWebview,
  ReviewerAction,
} from "./panel";
import {
  assistantRole,
  briefPrompt,
  chatPrompt,
  codeFlowWalkthroughPrompt,
  findingsPrompt,
  newHeadNote,
  readingOrderPrompt,
  Selection,
  sinceLastReviewPrompt,
  summaryPrompt,
} from "./prompts";
import { threadsOnLines, type ThreadInChange } from "./threads";
import type { FlowGraph } from "../codeFlow";
import { messageOf } from "../errors";
import type { PullRequestDescription } from "../github/client";
import { findReferences } from "../markdown";
import {
  parseReadingOrder,
  type ReadingOrder,
  type ReadingOrderState,
} from "../readingOrder";
import { openReference } from "../references";

/** Gives the head commit the Reviewer's last Review of the Change covered, if any. */
export type LastReview = (change: Change) => Promise<string | undefined>;

/** A pull request Change's description; undefined for a local Change. */
export type DescriptionOf = (
  change: Change
) => Promise<PullRequestDescription | undefined>;

/** How long a summary waits for the pull request's description before going without. */
const descriptionWait = 3_000;

/** What the Reviewer has in front of them, which each message tells the Assistant. */
export interface ReviewerView {
  /** The Change's review threads as they stand. */
  threadsOf(change: Change): ThreadInChange[];
  /** The file of the Change the Reviewer is reading, with the lines on screen, if any. */
  readingIn(change: Change): Selection | undefined;
}

/** What the Change's overview shows from the Assistant. */
export interface AssistantOverview {
  /** "Assistant" for the summary, or which Review an explanation is since. */
  label: string;
  /** Whether the Assistant is writing it. */
  reading: boolean;
  /** Markdown, as the Assistant wrote it so far. */
  text?: string;
  /** Why the Assistant can't write it, in words for the Reviewer. */
  problem?: string;
  /** The label of the button that helps with the problem, if one does. */
  problemAction?: string;
  /** Whether starting the Assistant again can mend the problem, such as once the Reviewer signed in. */
  canRetry?: boolean;
}

interface PanelState {
  title: string;
  sent: ConversationState;
  rendered?: ConversationState;
  receive(message: FromWebview): void;
}

export class Assistants implements vscode.Disposable {
  /** By the Change's conversation name, which outlasts new commits. */
  private readonly byConversation = new Map<string, ChangeAssistant>();
  private readonly view: AssistantView;
  /** The Assistant whose conversation the view shows. */
  private inView?: ChangeAssistant;
  /** The Change in front, which the view follows. */
  private front?: Change;
  private readonly subscriptions: vscode.Disposable[];
  private readonly status: vscode.StatusBarItem;
  private readonly overviewChanged = new vscode.EventEmitter<string>();
  /** Fires with a Change's conversation name when its overview's Assistant part changes. */
  readonly onDidChangeOverview = this.overviewChanged.event;
  private readonly readingOrderChanged = new vscode.EventEmitter<string>();
  /** Fires with a Change's conversation name when its Reading Order, or the writing of one, changes. */
  readonly onDidChangeReadingOrder = this.readingOrderChanged.event;

  /**
   * `claudePath` gives the Reviewer's Claude Path setting; empty means find
   * it. `openLink` opens a web link from a reply outside VS Code.
   */
  constructor(
    private readonly claudePath: () => string,
    private readonly conversations: Conversations,
    private readonly openLink: (uri: vscode.Uri) => Thenable<unknown>,
    private readonly lastReview: LastReview,
    /** The column a Change's code opens in, beside its overview. */
    private readonly codeColumn: (change: Change) => vscode.ViewColumn,
    private readonly reviewerView: ReviewerView,
    private readonly descriptionOf: DescriptionOf,
    /** The title of the Change's pull request, once it has loaded. */
    private readonly titleOf: (change: Change) => string | undefined
  ) {
    this.status = vscode.window.createStatusBarItem(
      "dearReviewer.claudeLogin",
      vscode.StatusBarAlignment.Right
    );
    this.status.name = "Dear Reviewer: Assistant";
    this.status.command = "dearReviewer.checkClaudeLogin";
    this.view = new AssistantView((action) => {
      if (action.type === "openAssistant")
        void vscode.commands.executeCommand("dearReviewer.showAssistant");
      else this.inView?.act(action);
    });
    this.subscriptions = [
      vscode.window.registerWebviewViewProvider(
        AssistantView.viewType,
        this.view,
        { webviewOptions: { retainContextWhenHidden: true } }
      ),
      // Looking at the view is asking for the Assistant of the Change in front.
      this.view.onDidShow(() => {
        if (!this.inView) this.showFront();
      }),
    ];
  }

  /**
   * Starts the Change's Assistant if it hasn't started, which writes the
   * summary the Change's overview shows; the view stays closed until the
   * Reviewer asks. If the Assistant is running for an older head of the same
   * Change, it moves to this one.
   */
  start(change: Change): Promise<void> {
    const existing = this.byConversation.get(change.conversation);
    if (existing) {
      existing.moveTo(change);
      return existing.started;
    }
    const assistant = new ChangeAssistant(
      change,
      this.conversations,
      this.conversations.get(change.conversation),
      this.openLink,
      this.lastReview,
      () => this.overviewChanged.fire(change.conversation),
      () => this.readingOrderChanged.fire(change.conversation),
      (current) => this.codeColumn(current),
      () => this.retryStart(assistant),
      this.reviewerView,
      this.descriptionOf,
      (current) => this.titleOf(current),
      (changed) => {
        if (this.inView === changed)
          this.view.update(changed.conversationState);
      }
    );
    this.byConversation.set(change.conversation, assistant);
    if (this.front?.conversation === change.conversation)
      this.showInView(assistant);
    // Its overview may already be open, showing nothing from it yet.
    this.overviewChanged.fire(change.conversation);
    return this.boot(assistant);
  }

  /**
   * Shows the Change's conversation in the view, starting its Assistant if
   * it hasn't started, and puts the cursor in the view's message box.
   */
  async open(change: Change): Promise<void> {
    const started = this.start(change);
    const assistant = this.byConversation.get(change.conversation);
    if (assistant) this.showInView(assistant);
    await this.view.reveal();
    await started;
  }

  /**
   * Has the view follow the Change in front when another comes to the
   * front: it shows that Change's conversation, starting its Assistant if
   * the view is in sight. Until then, it keeps showing any other Change's
   * conversation the Reviewer asked for.
   */
  follow(front: Change | undefined): void {
    if (front?.id === this.front?.id) return;
    this.front = front;
    this.showFront();
  }

  private showFront(): void {
    const front = this.front;
    if (!front) return;
    if (!this.byConversation.has(front.conversation) && this.view.visible)
      void this.start(front);
    const assistant = this.byConversation.get(front.conversation);
    if (assistant) this.showInView(assistant);
  }

  private showInView(assistant: ChangeAssistant): void {
    this.inView = assistant;
    this.view.update(assistant.conversationState);
  }

  /** What the Change's overview shows from its Assistant, once it has started. */
  overviewOf(change: Change): AssistantOverview | undefined {
    return this.byConversation.get(change.conversation)?.overview;
  }

  /**
   * The Change's Reading Order, from its Assistant if it has started, or
   * else as its saved conversation kept it.
   */
  readingOrderOf(change: Change): ReadingOrderState | undefined {
    const assistant = this.byConversation.get(change.conversation);
    if (assistant) return assistant.readingOrderState;
    const order = this.conversations.get(change.conversation)?.readingOrder;
    return order && { writing: false, order };
  }

  /** Has the Change's Assistant suggest a Reading Order again, starting it if it hasn't started. */
  async suggestReadingOrder(change: Change): Promise<void> {
    const assistant = this.started(change);
    await assistant.started;
    await assistant.suggestReadingOrder();
  }

  /** Runs the problem's button of the Change's Assistant, such as to set the Claude path. */
  helpWithProblem(change: Change): void {
    this.byConversation.get(change.conversation)?.helpWithProblem();
  }

  /** Starts the Change's Assistant again if `claude` couldn't run, such as once the Reviewer has signed in. */
  async retry(change: Change): Promise<void> {
    const assistant = this.byConversation.get(change.conversation);
    if (assistant) await this.retryStart(assistant);
  }

  private readonly retrying = new Set<ChangeAssistant>();

  private async retryStart(assistant: ChangeAssistant): Promise<void> {
    if (!assistant.unavailable || this.retrying.has(assistant)) return;
    this.retrying.add(assistant);
    try {
      await this.boot(assistant);
    } finally {
      this.retrying.delete(assistant);
    }
  }

  private async boot(assistant: ChangeAssistant): Promise<void> {
    try {
      const cli = new ClaudeCli(findClaude(this.claudePath()));
      const login = await this.showLogin(cli);
      assistant.update({ login: login.label });
      if (!login.signedIn) {
        throw new ClaudeProblem(
          "notSignedIn",
          "Claude Code isn't signed in on this machine. To use the Assistant, run `claude` in a terminal and sign in there, then choose Retry."
        );
      }
      await assistant.start(cli);
    } catch (err) {
      if (err instanceof ClaudeProblem && err.kind === "notFound")
        this.showStatus("Assistant: Claude not found", err.message, true);
      assistant.fail(err);
    }
  }

  /** Puts the selection into the chat of its Change's Assistant, to go with the next message. */
  async addSelection(
    change: Change,
    selection: Selection & { text: string }
  ): Promise<void> {
    const assistant = this.started(change);
    assistant.addSelection(selection);
    this.showInView(assistant);
    await this.view.reveal();
  }

  /**
   * Has the Change's Assistant write a Brief from the Reviewer's Comments,
   * starting it if it hasn't started, and gives the Brief. Its conversation
   * shows only a note about the Brief, which opens in the editor instead.
   */
  async writeBrief(change: Change, threads: LocalThread[]): Promise<string> {
    const assistant = this.started(change);
    const brief = await assistant.aside((current, note) =>
      briefPrompt(current, threads, note)
    );
    const count = threads.reduce((n, t) => n + t.comments.length, 0);
    assistant.addNote(
      `Wrote a Brief from your ${count} Comment${count === 1 ? "" : "s"}. It is open in the editor.`
    );
    return brief;
  }

  /**
   * Asks the Change's Assistant for Findings, starting it if it hasn't
   * started, and gives its reply, which the view doesn't show.
   */
  findIssues(change: Change): Promise<string> {
    return this.started(change).aside(findingsPrompt);
  }

  /**
   * Asks the Change's Assistant to walk through the calls of its Code Flow,
   * starting it if it hasn't started, and gives its reply, which the view
   * doesn't show.
   */
  walkThroughCodeFlow(change: Change, graph: FlowGraph): Promise<string> {
    return this.started(change).aside(async (_, note) =>
      codeFlowWalkthroughPrompt(graph, note)
    );
  }

  /** Has each Assistant's heading show its Change's title, such as once its pull request has loaded. */
  retitle(): void {
    for (const assistant of this.byConversation.values()) assistant.retitle();
  }

  /** Adds a note to the conversation of the Change's Assistant, if it has started. */
  addNote(change: Change, text: string): void {
    this.byConversation.get(change.conversation)?.addNote(text);
  }

  /**
   * Stops the Change's Assistant, unless it has moved to a newer head. The
   * conversation stays saved. A reply in progress gets a note saying it
   * stopped, unless `note` is false, as when a newer head of the same pull
   * request or branch takes over the conversation.
   */
  close(change: Change, note = true): void {
    const assistant = this.byConversation.get(change.conversation);
    if (assistant?.changeId !== change.id) return;
    if (note) assistant.stopWithNote();
    assistant.dispose();
    this.byConversation.delete(change.conversation);
    if (this.front?.id === change.id) this.front = undefined;
    if (this.inView !== assistant) return;
    this.inView = undefined;
    this.view.clear();
    // If it showed a Change other than the one in front, it goes back to that one.
    this.showFront();
  }

  /** The Change's Assistant, started or moved to this head if it wasn't. */
  private started(change: Change): ChangeAssistant {
    // Starting it, or moving it to this head, happens before it awaits anything.
    if (this.byConversation.get(change.conversation)?.changeId !== change.id)
      void this.start(change);
    const assistant = this.byConversation.get(change.conversation);
    if (!assistant) throw new Error("The Assistant didn't start.");
    return assistant;
  }

  /** Runs `claude auth status` and shows the login in the status bar. */
  async checkLogin(): Promise<ClaudeLogin | undefined> {
    try {
      return await this.showLogin(new ClaudeCli(findClaude(this.claudePath())));
    } catch (err) {
      const message = messageOf(err);
      this.showStatus("Assistant: Claude not found", message, true);
      void vscode.window.showErrorMessage(message);
    }
  }

  /** What each Assistant has for its overview, by its Change's title, for the tests. */
  overviews(): { title: string; take: AssistantOverview }[] {
    return [...this.byConversation.values()].map((a) => ({
      title: a.title,
      take: a.overview,
    }));
  }

  /** The conversation the view shows, if any, for the tests. */
  panels(): PanelState[] {
    const shown = this.inView;
    if (!shown) return [];
    // Just after the view moves to this conversation, its webview may not
    // have rendered it yet, and still shows the one before.
    const rendered = this.view.rendered;
    const { name, range } = shown.conversationState;
    return [
      {
        title: shown.title,
        sent: this.view.sent,
        rendered:
          rendered?.name === name && rendered.range === range
            ? rendered
            : undefined,
        receive: (message) => this.view.receive(message),
      },
    ];
  }

  /** Whether the view is in sight, and the title of the Change it shows, for the tests. */
  viewState(): { visible: boolean; showing?: string } {
    return { visible: this.view.visible, showing: this.inView?.title };
  }

  /** The view with no conversation, for the tests: what it was sent and rendered, and a way to send it what the webview would. */
  emptyView(): PanelState | undefined {
    if (this.inView) return;
    return {
      title: "",
      sent: this.view.sent,
      rendered: this.view.rendered,
      receive: (message) => this.view.receive(message),
    };
  }

  loginStatus():
    | { name: string; text: string; tooltip?: string; warning: boolean }
    | undefined {
    if (!this.status.text) return;
    const tooltip = this.status.tooltip;
    return {
      name: this.status.name ?? "",
      text: this.status.text,
      tooltip: typeof tooltip === "string" ? tooltip : tooltip?.value,
      warning: !!this.status.backgroundColor,
    };
  }

  dispose(): void {
    for (const assistant of this.byConversation.values()) assistant.dispose();
    this.byConversation.clear();
    for (const subscription of this.subscriptions) subscription.dispose();
    this.view.dispose();
    this.status.dispose();
    this.overviewChanged.dispose();
    this.readingOrderChanged.dispose();
  }

  private async showLogin(cli: ClaudeCli): Promise<ClaudeLogin> {
    const login = await cli.login();
    const text = !login.signedIn
      ? "Assistant: not signed in"
      : login.billedPerToken
        ? "Assistant: billed per token"
        : "Assistant ready";
    this.showStatus(
      text,
      `Runs on this Claude login: ${login.label} (\`${login.method}\`), as \`claude auth status\` reports it for \`${cli.executable}\`.`,
      !login.signedIn || login.billedPerToken
    );
    return login;
  }

  private showStatus(text: string, detail: string, warn: boolean): void {
    this.status.text = `$(dear-reviewer-logo) ${text}`;
    this.status.tooltip = new vscode.MarkdownString(
      `**Dear Reviewer Assistant**\n\n${detail}\n\nClick to check again.`
    );
    this.status.backgroundColor = warn
      ? new vscode.ThemeColor("statusBarItem.warningBackground")
      : undefined;
    this.status.show();
  }
}

class ChangeAssistant {
  private state: ConversationState;
  private cli?: ClaudeCli;
  private conversation?: ClaudeConversation;
  /** The Claude session and head the saved conversation has. */
  private session?: { id: string; headSha: string };
  /** The commits whose changes since the last Review were explained. */
  private explained?: { from: string; to: string; text?: string };
  /** News for the Assistant, sent with the Reviewer's next message. */
  private note?: string;
  /** Turns and moves run one after another. */
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  /** Where the turn under way, or the last one, shows its reply. */
  private turnInto?: "panel" | "overview" | "hidden";
  /** What the problem's button runs. */
  private problemAction?: vscode.Command;
  /** Whether the Reviewer asked to stop the turn under way. */
  private stopping = false;
  /** Settles once the Assistant has started, or failed to. */
  private readonly ready: Promise<void>;
  private settle!: () => void;
  /** The summary the conversation started with. */
  private summary?: string;
  private readingOrder?: ReadingOrder;
  /** Whether a Reading Order is being written. */
  private writingOrder = false;
  /** Whether the last Reading Order asked for failed, or came back unusable. */
  private orderProblem = false;
  private overviewState: AssistantOverview;

  constructor(
    private change: Change,
    private readonly conversations: Conversations,
    saved: SavedConversation | undefined,
    private readonly openLink: (uri: vscode.Uri) => Thenable<unknown>,
    private readonly lastReview: LastReview,
    /** Tells the Change's overview that what it shows from the Assistant changed. */
    private readonly overviewChanged: () => void,
    /** Tells Change Files and the overview that the Reading Order changed. */
    private readonly readingOrderChanged: () => void,
    /** The column the Change's code opens in. */
    private readonly codeColumn: (change: Change) => vscode.ViewColumn,
    /** Starts the Assistant again, once `claude` couldn't run. */
    private readonly retry: () => void,
    private readonly reviewerView: ReviewerView,
    private readonly descriptionOf: DescriptionOf,
    private readonly titleOf: (change: Change) => string | undefined,
    /** Tells the view, if it shows this conversation, that it changed. */
    private readonly stateChanged: (assistant: ChangeAssistant) => void
  ) {
    this.state = {
      ...namesOf(change, titleOf(change)),
      busy: true,
      messages: saved?.messages ?? [],
    };
    this.ready = new Promise((resolve) => (this.settle = resolve));
    // Conversations saved before the overview kept the summary as their first reply.
    this.summary =
      saved?.summary ??
      saved?.messages.find((m) => m.from === "assistant")?.text;
    this.readingOrder = saved?.readingOrder;
    const explained = saved?.sinceLastReview;
    this.overviewState =
      explained?.text && explained.to === change.headSha
        ? {
            label: sinceLabel(explained.from),
            reading: false,
            text: explained.text,
          }
        : { label: "Assistant", reading: !saved, text: this.summary };
    if (saved) {
      this.session = { id: saved.sessionId, headSha: saved.headSha };
      this.explained = saved.sinceLastReview;
      this.noteNewHead(saved.headSha);
    }
  }

  /** Settles once the Assistant has started, or failed to. */
  get started(): Promise<void> {
    return this.ready;
  }

  /** What the Change's overview shows from the Assistant. */
  get overview(): AssistantOverview {
    return this.overviewState;
  }

  get readingOrderState(): ReadingOrderState {
    return {
      writing: this.writingOrder,
      ...(this.orderProblem && { problem: true }),
      ...(this.readingOrder && { order: this.readingOrder }),
    };
  }

  /** Has the Assistant suggest a Reading Order, after whatever it is busy with. */
  suggestReadingOrder(): Promise<void> {
    return this.enqueue(() => this.writeReadingOrder());
  }

  /** Whether `claude` couldn't run, so the Assistant can't take a turn. */
  get unavailable(): boolean {
    return !this.cli;
  }

  /** Stops the turn under way; the next turn resumes the conversation. */
  stop(): void {
    if (!this.state.stoppable || !this.conversation) return;
    this.stopping = true;
    this.conversation.dispose();
  }

  /** Runs the button that helps with the Assistant's problem, if it has one. */
  helpWithProblem(): void {
    const help = this.problemAction;
    if (help)
      void vscode.commands.executeCommand(
        help.command,
        ...(help.arguments ?? [])
      );
  }

  get changeId(): string {
    return this.change.id;
  }

  /** The Change's title, which the tests find its Assistant by. */
  get title(): string {
    return changeTitle(this.change);
  }

  /** The conversation as the view shows it. */
  get conversationState(): ConversationState {
    return this.state;
  }

  update(changes: Partial<ConversationState>): void {
    this.state = { ...this.state, ...changes };
    this.stateChanged(this);
  }

  /**
   * Starts with a summary if the conversation is new; a saved conversation
   * waits for the Reviewer's next message, which resumes its session. Either
   * way, the Assistant then explains what changed since the last Review.
   */
  async start(cli: ClaudeCli): Promise<void> {
    if (this.disposed) return;
    this.cli = cli;
    // A retry starts again after the problem that stopped the last start.
    this.problemAction = undefined;
    this.update({
      problem: undefined,
      problemAction: undefined,
      unavailable: undefined,
    });
    if (this.overviewState.problem) this.setOverview({});
    let summary = Promise.resolve();
    if (this.session) this.update({ busy: false });
    else
      summary = this.enqueue(async () => {
        this.setOverview({
          label: "Assistant",
          reading: true,
          text: undefined,
        });
        this.update({
          messages: [
            ...this.state.messages,
            { from: "note", text: summaryNote },
          ],
        });
        const description = await within(
          this.descriptionOf(this.change),
          descriptionWait
        );
        const text = await this.turn(
          await summaryPrompt(this.change, description),
          "overview"
        );
        if (text === undefined) return;
        this.summary = text;
        this.save();
        await this.writeReadingOrder();
      });
    this.settle();
    await summary;
    await this.explainSinceLastReview();
  }

  /** Carries the conversation on at the Change's new head. */
  retitle(): void {
    this.update(namesOf(this.change, this.titleOf(this.change)));
  }

  moveTo(change: Change): void {
    if (change.id === this.change.id) return;
    void this.enqueue(async () => {
      const previousHead = this.change.headSha;
      this.change = change;
      // The next turn restarts `claude` with the new worktrees.
      this.conversation?.dispose();
      this.conversation = undefined;
      this.update(namesOf(change, this.titleOf(change)));
      this.noteNewHead(previousHead);
    });
    void this.explainSinceLastReview();
  }

  addSelection(selection: Selection & { text: string }): void {
    this.update({ context: [...(this.state.context ?? []), selection] });
  }

  /**
   * Has the Assistant answer a prompt the view doesn't show, such as for a
   * Brief or Findings, after whatever it is busy with, and gives the reply.
   * `promptOf` gets the Change at its current head, and any news for the
   * Assistant to go first.
   */
  async aside(
    promptOf: (change: Change, note?: string) => Promise<string>
  ): Promise<string> {
    await this.ready;
    const reply = this.queue.then(async () => {
      if (this.disposed) throw new Error("The Assistant was closed.");
      const prompt = await promptOf(this.change, this.note);
      this.note = undefined;
      let text: string | undefined;
      try {
        text = await this.turn(prompt, "hidden");
      } catch (err) {
        this.fail(err);
        throw err;
      }
      if (text === undefined) throw new Error("The Assistant was closed.");
      return text;
    });
    this.queue = reply.catch(() => undefined);
    return reply;
  }

  /** Adds a note to the conversation, kept with it, once no turn is running. */
  addNote(text: string): void {
    void this.enqueue(async () => {
      this.update({
        messages: [...this.state.messages, { from: "note", text }],
      });
      this.save();
    });
  }

  fail(err: unknown): void {
    this.settle();
    if (this.disposed) return;
    this.problemAction =
      err instanceof ClaudeProblem ? helpWith(err) : undefined;
    this.update({
      busy: false,
      stoppable: undefined,
      steps: undefined,
      problem: messageOf(err),
      problemAction: this.problemAction?.title,
      unavailable: this.unavailable || undefined,
    });
    // A later failure, such as of a chat turn, leaves a written summary be.
    if (this.overviewState.reading || !this.overviewState.text)
      this.setOverview({
        reading: false,
        problem: messageOf(err),
        problemAction: this.problemAction?.title,
        canRetry: this.unavailable || undefined,
      });
  }

  /**
   * Ends a reply in progress as its Change stops (ADR 0040), with a note in
   * the conversation, which is kept so the Change picks it up when it opens
   * again.
   */
  stopWithNote(): void {
    // A turn the view doesn't show, such as for Findings, leaves no note.
    if (!this.state.stoppable || !this.conversation) return;
    if (this.turnInto !== "panel") return;
    this.update({
      busy: false,
      stoppable: undefined,
      steps: undefined,
      messages: [
        ...this.state.messages,
        {
          from: "note",
          text: "Stopped before the reply was finished, because the Change stopped being reviewed.",
        },
      ],
    });
    this.save(this.conversation);
  }

  dispose(): void {
    this.disposed = true;
    this.conversation?.dispose();
  }

  /** Does what the Reviewer did in the view while it showed this conversation. */
  act(action: Exclude<ReviewerAction, { type: "openAssistant" }>): void {
    if (action.type === "problemAction") this.helpWithProblem();
    else if (action.type === "retry") this.retry();
    else if (action.type === "stop") this.stop();
    else if (action.type === "removeContext") {
      const context = [...(this.state.context ?? [])];
      context.splice(action.index, 1);
      this.update({ context: context.length ? context : undefined });
    } else if (action.type === "openLink") {
      // The view passes on only links from the replies it was sent.
      if (/^https?:\/\//i.test(action.url))
        void this.openLink(vscode.Uri.parse(action.url, true));
    } else if (action.type === "openReference") {
      void openReference(
        this.change,
        action.path,
        action.startLine,
        action.endLine,
        this.codeColumn(this.change)
      );
    } else void this.ask(action.text);
  }

  private async ask(question: string): Promise<void> {
    const context = this.state.context ?? [];
    this.update({
      busy: true,
      context: undefined,
      messages: [
        ...this.state.messages,
        {
          from: "reviewer",
          text: question,
          ...(context.length && {
            context: context.map(({ text: _, ...selection }) => selection),
          }),
        },
      ],
    });
    await this.enqueue(async () => {
      const threads = this.reviewerView.threadsOf(this.change);
      const prompt = chatPrompt(
        this.change,
        question,
        context.map((selection) => ({
          ...selection,
          threads: threadsOnLines(threads, selection),
        })),
        this.note,
        this.reviewerView.readingIn(this.change)
      );
      this.note = undefined;
      await this.turn(prompt);
    });
  }

  /**
   * Explains what changed since the Reviewer's last Review, unless the
   * Change is at the reviewed commit, or these commits were explained
   * before. Without a Review it can learn of, it says nothing.
   */
  private explainSinceLastReview(): Promise<void> {
    return this.enqueue(async () => {
      if (!this.cli) return;
      const change = this.change;
      const from = await this.lastReview(change).catch(() => undefined);
      if (this.disposed || change !== this.change) return;
      if (!from || from === change.headSha) return;
      if (this.explained?.from === from && this.explained.to === change.headSha)
        return;
      const prompt = await sinceLastReviewPrompt(change, from, this.note);
      this.note = undefined;
      this.setOverview({
        label: sinceLabel(from),
        reading: true,
        text: undefined,
      });
      this.update({
        messages: [
          ...this.state.messages,
          {
            from: "note",
            text: `Explained what changed since your last Review, at ${from.slice(0, 7)}, in the Change's overview.`,
          },
        ],
      });
      const text = await this.turn(prompt, "overview");
      if (this.disposed || text === undefined) return;
      this.explained = { from, to: change.headSha, text };
      this.save();
    });
  }

  /**
   * Asks for a Reading Order in a turn the view doesn't show, starting at
   * the summary's start, and keeps it if the reply holds a usable one. If
   * the turn fails, or the reply holds no usable order, the Change stays in
   * tree order and the overview says so, with a way to try again.
   */
  private async writeReadingOrder(): Promise<void> {
    const change = this.change;
    const files = inTreeOrder(change, await changedFiles(change)).map(
      (f) => f.path
    );
    const start = findReferences(this.summary ?? "").find((ref) =>
      files.includes(ref.path)
    )?.path;
    const prompt = readingOrderPrompt(files, start, this.note);
    this.note = undefined;
    this.orderProblem = false;
    this.setWritingOrder(true);
    let reply: string | undefined;
    try {
      reply = await this.turn(prompt, "hidden");
    } catch {
      this.orderProblem = true;
      this.update({ busy: false, stoppable: undefined, steps: undefined });
    } finally {
      this.setWritingOrder(false);
    }
    if (this.disposed) return;
    const steps =
      reply === undefined ? undefined : parseReadingOrder(reply, files, start);
    if (!steps) {
      // A reply stopped on purpose, with nothing back, isn't a problem.
      if (reply !== undefined && !this.orderProblem) {
        this.orderProblem = true;
        this.readingOrderChanged();
      }
      return;
    }
    this.readingOrder = { headSha: change.headSha, steps };
    this.save();
    this.readingOrderChanged();
  }

  private setWritingOrder(writing: boolean): void {
    if (this.disposed) return;
    this.writingOrder = writing;
    this.readingOrderChanged();
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(async () => {
      if (this.disposed) return;
      try {
        await task();
      } catch (err) {
        this.fail(err);
      }
    });
    this.queue = run;
    return run;
  }

  /**
   * Sends the prompt and streams the reply into the conversation, or the overview,
   * or neither, and gives the reply, if the Assistant is still open.
   */
  private async turn(
    prompt: string,
    into: "panel" | "overview" | "hidden" = "panel"
  ): Promise<string | undefined> {
    if (!this.cli)
      throw new ClaudeProblem(
        "failed",
        this.state.problem ?? "The Assistant hasn't started yet."
      );
    this.problemAction = undefined;
    this.turnInto = into;
    this.update({
      busy: true,
      stoppable: true,
      steps: undefined,
      problem: undefined,
      problemAction: undefined,
    });
    const conversation = this.conversationNow(this.cli);
    const index = this.state.messages.length;
    const reply = (text: string) => {
      if (into === "overview") return this.setOverview({ text });
      if (into === "hidden") return;
      const messages = [...this.state.messages];
      messages[index] = { from: "assistant", text };
      this.update({ messages });
    };
    const step = (use: ToolUse) =>
      this.update({
        steps: [...(this.state.steps ?? []), describeToolUse(this.change, use)],
      });
    let text: string;
    try {
      text = await conversation.ask(prompt, reply, step);
      reply(text);
    } catch (err) {
      if (this.disposed) return;
      // The next turn starts `claude` again, resuming the session if it has one.
      conversation.dispose();
      if (this.conversation === conversation) this.conversation = undefined;
      if (this.stopping) {
        this.stopping = false;
        this.save(conversation);
        if (into === "overview") this.setOverview({ reading: false });
        this.update({
          busy: false,
          stoppable: undefined,
          steps: undefined,
          messages: [
            ...this.state.messages,
            { from: "note", text: "Stopped before the reply was finished." },
          ],
        });
        return;
      }
      if (!conversation.resumed || conversation.answered) {
        this.save(conversation);
        throw err;
      }
      // Claude Code no longer has the session: start again without it.
      this.session = undefined;
      this.conversations.forget(this.change.conversation);
      this.update({
        messages: [
          ...this.state.messages.slice(0, index),
          {
            from: "note",
            text: "Claude Code couldn't resume the earlier conversation, so the Assistant starts again without it.",
          },
        ],
      });
      return this.turn(prompt, into);
    }
    if (this.disposed) return;
    if (into === "overview") this.setOverview({ reading: false });
    this.update({ busy: false, stoppable: undefined, steps: undefined });
    this.save(conversation);
    return text;
  }

  /** The running conversation, or a new `claude` that resumes the saved session. */
  private conversationNow(cli: ClaudeCli): ClaudeConversation {
    if (!this.conversation) {
      // Its files may not be written yet, and `claude` reads only folders that exist.
      fs.mkdirSync(assistantDir(this.change), { recursive: true, mode: 0o700 });
      this.conversation = cli.converse({
        cwd: this.conversations.workingDirectory(this.change.conversation),
        addDirs: [
          this.change.headDir,
          this.change.baseDir,
          assistantDir(this.change),
        ],
        systemPrompt: assistantRole(this.change),
        resume: this.session?.id,
        history: {
          repository: this.change.repository,
          base: this.change.mergeBase,
          head: this.change.headSha,
        },
      });
    }
    return this.conversation;
  }

  /** Changes what the overview shows; a problem lasts only until the next change. */
  private setOverview(changes: Partial<AssistantOverview>): void {
    const {
      problem: _problem,
      problemAction: _action,
      canRetry: _retry,
      ...kept
    } = this.overviewState;
    const next: AssistantOverview = { ...kept, ...changes };
    for (const key of Object.keys(next) as (keyof AssistantOverview)[])
      if (next[key] === undefined) delete next[key];
    this.overviewState = next;
    this.overviewChanged();
  }

  private noteNewHead(previousHead: string): void {
    if (previousHead === this.change.headSha) return;
    this.note = newHeadNote(this.change, previousHead);
    this.update({
      messages: [
        ...this.state.messages,
        {
          from: "note",
          text: `New commits: the Change is now at ${this.change.headSha.slice(0, 7)}, after ${previousHead.slice(0, 7)}.`,
        },
      ],
    });
  }

  /** Keeps the conversation for later, once Claude Code has a session for it. */
  private save(conversation?: ClaudeConversation): void {
    const id = conversation?.sessionId ?? this.session?.id;
    if (!id) return;
    this.session = { id, headSha: this.change.headSha };
    this.conversations.put(this.change.conversation, {
      sessionId: id,
      headSha: this.change.headSha,
      messages: this.state.messages,
      ...(this.summary && { summary: this.summary }),
      ...(this.explained && { sinceLastReview: this.explained }),
      ...(this.readingOrder && { readingOrder: this.readingOrder }),
    });
  }
}

/** The note a conversation starts with, before the summary is written, which may still fail. */
const summaryNote =
  "The Assistant's summary of this Change is in its overview.";

/**
 * What the view shows of the Change: with the pull request's title, the
 * title in the heading and where the Change comes from under it; until
 * then, its name over its commits.
 */
function namesOf(
  change: Change,
  title?: string
): Pick<ConversationState, "name" | "range" | "heading"> {
  return {
    name: changeName(change),
    range: title
      ? changeSource(change)
      : `${change.mergeBase.slice(0, 7)}..${change.headSha.slice(0, 7)}`,
    ...(title && { heading: title }),
  };
}

/** What the promise gives within `ms`, or undefined if it fails or takes longer. */
async function within<T>(
  promise: Promise<T>,
  ms: number
): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  try {
    return await Promise.race([promise.catch(() => undefined), late]);
  } finally {
    clearTimeout(timer);
  }
}

function sinceLabel(from: string): string {
  return `Since your Review at ${from.slice(0, 7)}`;
}

/** The button that helps with a problem with `claude`, if one can. */
function helpWith(problem: ClaudeProblem): vscode.Command | undefined {
  if (problem.kind === "notFound")
    return {
      title: "Set Claude Path",
      command: "workbench.action.openSettings",
      arguments: ["dearReviewer.claudePath"],
    };
  if (problem.kind === "notSignedIn")
    return {
      title: "Open a Terminal",
      command: "workbench.action.terminal.new",
    };
}
