// The Assistant for each Change shown in this window: one conversation and
// one panel per Change, where the Reviewer chats with the Assistant. A
// Change keeps its conversation across new commits and window reloads (ADR
// 0009): a new conversation starts with a summary of what the Change does
// and where the risk is, and a saved one carries on with `claude --resume`.
// When the Change has new commits since the Reviewer's last Review, the
// Assistant explains what changed, once for each such pair of commits (ADR
// 0015). At the end of a local Change's Review, it turns the Reviewer's
// Comments into a Brief in the same conversation (ADR 0016), and when the
// Reviewer asks, it raises Findings there too (ADR 0017).

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { Change, changeTitle } from "../changeWorkspace";
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
  AssistantPanel,
  ConversationState,
  FromWebview,
  ReviewerAction,
} from "./panel";
import {
  assistantRole,
  briefPrompt,
  chatPrompt,
  findingsPrompt,
  newHeadNote,
  Selection,
  sinceLastReviewPrompt,
  summaryPrompt,
} from "./prompts";
import { messageOf } from "../errors";

/** Gives the head commit the Reviewer's last Review of the Change covered, if any. */
export type LastReview = (change: Change) => Promise<string | undefined>;

interface PanelState {
  title: string;
  sent: ConversationState;
  rendered?: ConversationState;
  receive(message: FromWebview): void;
}

export class Assistants implements vscode.Disposable {
  /** By the Change's conversation name, which outlasts new commits. */
  private readonly byConversation = new Map<string, ChangeAssistant>();
  private readonly status: vscode.StatusBarItem;

  /**
   * `claudePath` gives the Reviewer's Claude Path setting; empty means find
   * it. `openLink` opens a web link from a reply outside VS Code.
   */
  constructor(
    private readonly claudePath: () => string,
    private readonly conversations: Conversations,
    private readonly openLink: (uri: vscode.Uri) => Thenable<unknown>,
    private readonly lastReview: LastReview
  ) {
    this.status = vscode.window.createStatusBarItem(
      "dearReviewer.claudeLogin",
      vscode.StatusBarAlignment.Right
    );
    this.status.name = "Dear Reviewer: Claude login";
    this.status.command = "dearReviewer.checkClaudeLogin";
  }

  /**
   * Shows the Change's Assistant, starting it if it hasn't started. If the
   * Assistant is open for an older head of the same Change, it moves to this
   * one.
   */
  async open(change: Change): Promise<void> {
    const existing = this.byConversation.get(change.conversation);
    if (existing) {
      existing.moveTo(change);
      return existing.show();
    }
    const assistant = new ChangeAssistant(
      change,
      this.conversations,
      this.conversations.get(change.conversation),
      this.openLink,
      this.lastReview
    );
    this.byConversation.set(change.conversation, assistant);
    assistant.show();
    try {
      const cli = new ClaudeCli(findClaude(this.claudePath()));
      const login = await this.showLogin(cli);
      assistant.update({ login: login.label });
      if (!login.signedIn) {
        throw new ClaudeProblem(
          "notSignedIn",
          "Claude Code isn't signed in on this machine. To use the Assistant, run `claude` in a terminal and sign in there, then reopen the Change."
        );
      }
      await assistant.start(cli);
    } catch (err) {
      if (err instanceof ClaudeProblem && err.kind === "notFound")
        this.showStatus("$(error) Claude: not found", err.message, true);
      assistant.fail(err);
    }
  }

  /** Puts the selection into the chat of its Change's Assistant, to go with the next message. */
  async addSelection(
    change: Change,
    selection: Selection & { text: string }
  ): Promise<void> {
    this.started(change).addSelection(selection);
  }

  /**
   * Has the Change's Assistant write a Brief from the Reviewer's Comments,
   * starting it if it hasn't started, and gives the Brief. Its panel shows
   * only a note about the Brief, which opens in the editor instead.
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
   * started, and gives its reply, which the panel doesn't show.
   */
  findIssues(change: Change): Promise<string> {
    return this.started(change).aside(findingsPrompt);
  }

  /** Adds a note to the Change's Assistant panel, if it has one. */
  addNote(change: Change, text: string): void {
    this.byConversation.get(change.conversation)?.addNote(text);
  }

  /** Stops the Change's Assistant, unless it has moved to a newer head. The conversation stays saved. */
  close(change: Change): void {
    const assistant = this.byConversation.get(change.conversation);
    if (assistant?.changeId !== change.id) return;
    assistant.dispose();
    this.byConversation.delete(change.conversation);
  }

  /** The Change's Assistant, started or moved to this head if it wasn't. */
  private started(change: Change): ChangeAssistant {
    // Opening starts the Assistant, or moves it to this head, before it awaits anything.
    if (this.byConversation.get(change.conversation)?.changeId !== change.id)
      void this.open(change);
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
      this.showStatus("$(error) Claude: not found", message, true);
      void vscode.window.showErrorMessage(message);
    }
  }

  /** Each panel's conversation, for the tests. */
  panels(): PanelState[] {
    return [...this.byConversation.values()].flatMap((a) => a.panelStates());
  }

  loginStatus(): { text: string; tooltip?: string } | undefined {
    if (!this.status.text) return;
    const tooltip = this.status.tooltip;
    return {
      text: this.status.text,
      tooltip: typeof tooltip === "string" ? tooltip : tooltip?.value,
    };
  }

  dispose(): void {
    for (const assistant of this.byConversation.values()) assistant.dispose();
    this.byConversation.clear();
    this.status.dispose();
  }

  private async showLogin(cli: ClaudeCli): Promise<ClaudeLogin> {
    const login = await cli.login();
    const icon =
      !login.signedIn || login.billedPerToken ? "$(warning)" : "$(sparkle)";
    this.showStatus(
      `${icon} Claude: ${login.label}`,
      `The Assistant runs on this Claude login (\`${login.method}\`), as \`claude auth status\` reports it for ${cli.executable}. Click to check again.`,
      !login.signedIn || login.billedPerToken
    );
    return login;
  }

  private showStatus(text: string, tooltip: string, warn: boolean): void {
    this.status.text = text;
    this.status.tooltip = new vscode.MarkdownString(tooltip);
    this.status.backgroundColor = warn
      ? new vscode.ThemeColor("statusBarItem.warningBackground")
      : undefined;
    this.status.show();
  }
}

class ChangeAssistant {
  private state: ConversationState;
  private panel?: AssistantPanel;
  private cli?: ClaudeCli;
  private conversation?: ClaudeConversation;
  /** The Claude session and head the saved conversation has. */
  private session?: { id: string; headSha: string };
  /** The commits whose changes since the last Review were explained. */
  private explained?: { from: string; to: string };
  /** News for the Assistant, sent with the Reviewer's next message. */
  private note?: string;
  /** Turns and moves run one after another. */
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  /** What the problem's button runs. */
  private problemAction?: vscode.Command;
  /** Settles once the Assistant has started, or failed to. */
  private readonly ready: Promise<void>;
  private settle!: () => void;

  constructor(
    private change: Change,
    private readonly conversations: Conversations,
    saved: SavedConversation | undefined,
    private readonly openLink: (uri: vscode.Uri) => Thenable<unknown>,
    private readonly lastReview: LastReview
  ) {
    this.state = {
      title: changeTitle(change),
      busy: true,
      messages: saved?.messages ?? [],
    };
    this.ready = new Promise((resolve) => (this.settle = resolve));
    if (saved) {
      this.session = { id: saved.sessionId, headSha: saved.headSha };
      this.explained = saved.sinceLastReview;
      this.noteNewHead(saved.headSha);
    }
  }

  get changeId(): string {
    return this.change.id;
  }

  show(): void {
    if (this.panel) return this.panel.reveal();
    const panel = new AssistantPanel(this.state, (action) => this.act(action));
    panel.onDidDispose(() => {
      if (this.panel === panel) this.panel = undefined;
    });
    this.panel = panel;
  }

  update(changes: Partial<ConversationState>): void {
    this.state = { ...this.state, ...changes };
    this.panel?.update(this.state);
  }

  /**
   * Starts with a summary if the conversation is new; a saved conversation
   * waits for the Reviewer's next message, which resumes its session. Either
   * way, the Assistant then explains what changed since the last Review.
   */
  async start(cli: ClaudeCli): Promise<void> {
    if (this.disposed) return;
    this.cli = cli;
    let summary = Promise.resolve();
    if (this.session) this.update({ busy: false });
    else
      summary = this.enqueue(async () => {
        await this.turn(await summaryPrompt(this.change));
      });
    this.settle();
    await summary;
    await this.explainSinceLastReview();
  }

  /** Carries the conversation on at the Change's new head. */
  moveTo(change: Change): void {
    if (change.id === this.change.id) return;
    void this.enqueue(async () => {
      const previousHead = this.change.headSha;
      this.change = change;
      // The next turn restarts `claude` with the new worktrees.
      this.conversation?.dispose();
      this.conversation = undefined;
      this.update({ title: changeTitle(change) });
      this.noteNewHead(previousHead);
    });
    void this.explainSinceLastReview();
  }

  addSelection(selection: Selection & { text: string }): void {
    this.update({ context: [...(this.state.context ?? []), selection] });
    this.panel?.reveal(true);
  }

  /**
   * Has the Assistant answer a prompt the panel doesn't show, such as for a
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
        text = await this.turn(prompt, false);
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

  /** Adds a note to the panel, kept with the conversation, once no turn is running. */
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
      steps: undefined,
      problem: messageOf(err),
      problemAction: this.problemAction?.title,
    });
  }

  panelStates(): PanelState[] {
    const panel = this.panel;
    if (!panel) return [];
    return [
      {
        title: this.state.title,
        sent: panel.sent,
        rendered: panel.rendered,
        receive: (message) => panel.receive(message),
      },
    ];
  }

  dispose(): void {
    this.disposed = true;
    this.conversation?.dispose();
    this.panel?.dispose();
  }

  private act(action: ReviewerAction): void {
    if (action.type === "problemAction") {
      const help = this.problemAction;
      if (help)
        void vscode.commands.executeCommand(
          help.command,
          ...(help.arguments ?? [])
        );
    } else if (action.type === "removeContext") {
      const context = [...(this.state.context ?? [])];
      context.splice(action.index, 1);
      this.update({ context: context.length ? context : undefined });
    } else if (action.type === "openLink") {
      // The panel passes on only links from the replies it was sent.
      if (/^https?:\/\//i.test(action.url))
        void this.openLink(vscode.Uri.parse(action.url, true));
    } else if (action.type === "openReference") {
      void this.openReference(action.path, action.startLine, action.endLine);
    } else void this.ask(action.text);
  }

  /**
   * Opens a file a reply points at, at those lines: a relative path in the
   * head worktree, an absolute one in either worktree, and nothing outside
   * them, even through a symbolic link.
   */
  private async openReference(
    reference: string,
    startLine: number,
    endLine: number
  ): Promise<void> {
    const file = path.resolve(this.change.headDir, reference);
    let real: string;
    try {
      real = fs.realpathSync(file);
      if (!fs.statSync(real).isFile()) return;
    } catch {
      return;
    }
    const worktrees = [this.change.headDir, this.change.baseDir].flatMap(
      (dir) => {
        try {
          return [fs.realpathSync(dir)];
        } catch {
          return [];
        }
      }
    );
    if (
      !worktrees.some((dir) => {
        const relative = path.relative(dir, real);
        return (
          relative && !relative.startsWith("..") && !path.isAbsolute(relative)
        );
      })
    )
      return;
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(file)
    );
    const last = document.lineCount - 1;
    const start = Math.min(Math.max(startLine, 1) - 1, last);
    const end = Math.min(Math.max(endLine, startLine) - 1, last);
    const range = new vscode.Range(
      start,
      0,
      end,
      document.lineAt(end).range.end.character
    );
    await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.One,
      selection: range,
      preview: true,
    });
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
      const prompt = chatPrompt(this.change, question, context, this.note);
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
      this.update({
        messages: [
          ...this.state.messages,
          {
            from: "note",
            text: `What changed since your last Review, at ${from.slice(0, 7)}:`,
          },
        ],
      });
      await this.turn(prompt);
      if (this.disposed) return;
      this.explained = { from, to: change.headSha };
      this.save();
    });
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
   * Sends the prompt and streams the reply into the panel, unless it isn't
   * `shown`, and gives the reply, if the Assistant is still open.
   */
  private async turn(
    prompt: string,
    shown = true
  ): Promise<string | undefined> {
    if (!this.cli)
      throw new ClaudeProblem(
        "failed",
        this.state.problem ?? "The Assistant hasn't started yet."
      );
    this.problemAction = undefined;
    this.update({
      busy: true,
      steps: undefined,
      problem: undefined,
      problemAction: undefined,
    });
    const conversation = this.conversationNow(this.cli);
    const index = this.state.messages.length;
    const reply = (text: string) => {
      if (!shown) return;
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
      return this.turn(prompt, shown);
    }
    if (this.disposed) return;
    this.update({ busy: false, steps: undefined });
    this.save(conversation);
    return text;
  }

  /** The running conversation, or a new `claude` that resumes the saved session. */
  private conversationNow(cli: ClaudeCli): ClaudeConversation {
    if (!this.conversation) {
      this.conversation = cli.converse({
        cwd: this.conversations.workingDirectory(this.change.conversation),
        addDirs: [this.change.headDir, this.change.baseDir],
        systemPrompt: assistantRole(this.change),
        resume: this.session?.id,
      });
    }
    return this.conversation;
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
      ...(this.explained && { sinceLastReview: this.explained }),
    });
  }
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
