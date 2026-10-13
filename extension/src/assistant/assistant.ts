// The Assistant for each Change shown in this window: one `claude`
// conversation and one panel per Change. Opening a Change starts with a
// summary of what it does and where the risk is.

import * as vscode from "vscode";
import { Change, changeTitle } from "../changeWorkspace";
import {
  ClaudeCli,
  ClaudeConversation,
  ClaudeLogin,
  ClaudeProblem,
  findClaude,
} from "./claude";
import { AssistantPanel, ConversationState } from "./panel";
import { assistantRole, summaryPrompt } from "./prompts";

export class Assistants implements vscode.Disposable {
  private readonly byChange = new Map<string, ChangeAssistant>();
  private readonly status: vscode.StatusBarItem;

  /** `claudePath` gives the Reviewer's Claude Path setting; empty means find it. */
  constructor(private readonly claudePath: () => string) {
    this.status = vscode.window.createStatusBarItem(
      "dearReviewer.claudeLogin",
      vscode.StatusBarAlignment.Right
    );
    this.status.name = "Dear Reviewer: Claude login";
    this.status.command = "dearReviewer.checkClaudeLogin";
  }

  /** Shows the Change's Assistant, starting it with a summary if it hasn't started. */
  async open(change: Change): Promise<void> {
    const existing = this.byChange.get(change.id);
    if (existing) return existing.show();
    const assistant = new ChangeAssistant(change);
    this.byChange.set(change.id, assistant);
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
      await assistant.summarise(cli);
    } catch (err) {
      if (err instanceof ClaudeProblem && err.kind === "notFound")
        this.showStatus("$(error) Claude: not found", err.message, true);
      assistant.fail(err);
    }
  }

  close(change: Change): void {
    this.byChange.get(change.id)?.dispose();
    this.byChange.delete(change.id);
  }

  /** Runs `claude auth status` and shows the login in the status bar. */
  async checkLogin(): Promise<ClaudeLogin | undefined> {
    try {
      return await this.showLogin(new ClaudeCli(findClaude(this.claudePath())));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.showStatus("$(error) Claude: not found", message, true);
      void vscode.window.showErrorMessage(message);
    }
  }

  /** Each panel's conversation, for the tests. */
  panels(): {
    title: string;
    sent: ConversationState;
    rendered?: ConversationState;
  }[] {
    return [...this.byChange.values()].flatMap((a) => a.panelStates());
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
    for (const assistant of this.byChange.values()) assistant.dispose();
    this.byChange.clear();
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
  private conversation?: ClaudeConversation;
  private disposed = false;

  constructor(private readonly change: Change) {
    this.state = { title: changeTitle(change), busy: true, messages: [] };
  }

  show(): void {
    if (this.panel) return this.panel.reveal();
    const panel = new AssistantPanel(this.state);
    panel.onDidDispose(() => {
      if (this.panel === panel) this.panel = undefined;
    });
    this.panel = panel;
  }

  update(changes: Partial<ConversationState>): void {
    this.state = { ...this.state, ...changes };
    this.panel?.update(this.state);
  }

  async summarise(cli: ClaudeCli): Promise<void> {
    if (this.disposed) return;
    const conversation = cli.converse({
      cwd: this.change.headDir,
      addDirs: [this.change.baseDir],
      systemPrompt: assistantRole(this.change),
    });
    this.conversation = conversation;
    const index = this.state.messages.length;
    const reply = (text: string) => {
      const messages = [...this.state.messages];
      messages[index] = { from: "assistant", text };
      this.update({ messages });
    };
    const summary = await conversation.ask(
      await summaryPrompt(this.change),
      reply
    );
    reply(summary);
    this.update({ busy: false });
  }

  fail(err: unknown): void {
    if (this.disposed) return;
    this.update({
      busy: false,
      problem: err instanceof Error ? err.message : String(err),
    });
  }

  panelStates(): {
    title: string;
    sent: ConversationState;
    rendered?: ConversationState;
  }[] {
    if (!this.panel) return [];
    return [
      {
        title: this.state.title,
        sent: this.panel.sent,
        rendered: this.panel.rendered,
      },
    ];
  }

  dispose(): void {
    this.disposed = true;
    this.conversation?.dispose();
    this.panel?.dispose();
  }
}
