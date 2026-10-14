// Workspace trust for the review window. Its folders, the Changes'
// worktrees, live in Dear Reviewer's storage, which the editor doesn't
// trust until the Reviewer says so; until then language servers, and with
// them navigation, stay off (see ADR 0010, ADR 0021). Trusting the folder is a real
// trade-off, so Dear Reviewer asks once, the first time a Change opens, and
// takes Not now, or no answer, for good, remembered in a file in its
// storage, as its other state is. An untrusted review window shows a
// quiet hint in the status bar instead, so the choice can still be found.
// No API grants trust, so Dear Reviewer can only take the Reviewer to
// Workspace Trust with the folder's path ready to paste.

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { setContext } from "./context";

/** Asks a question with these buttons; gives the one chosen, if any. */
export type Ask = (
  message: string,
  ...buttons: string[]
) => Thenable<string | undefined>;

const trustButton = "Trust…";
const notNow = "Not now";

/** What every window, and the next start, needs to know. */
interface Remembered {
  /** Whether the Reviewer was asked; Not now, or no answer, is for good. */
  asked?: boolean;
  /** Whether the review window was trusted when it last said. */
  reviewWindowTrusted?: boolean;
}

export class ReviewWindowTrust implements vscode.Disposable {
  private isTrusted = () => vscode.workspace.isTrusted;
  private ask: Ask = (message, ...buttons) =>
    vscode.window.showWarningMessage(message, ...buttons);
  private readonly file: string;
  private hintShown = false;
  private readonly hintItem: vscode.StatusBarItem;
  private readonly subscriptions: vscode.Disposable[] = [];

  /** Keeps the Reviewer's answer in `trust.json` in the storage folder. */
  constructor(
    private readonly storageDir: string,
    private isReviewWindow: () => boolean
  ) {
    this.file = path.join(storageDir, "trust.json");
    this.hintItem = vscode.window.createStatusBarItem(
      "dearReviewer.trustHint",
      vscode.StatusBarAlignment.Left
    );
    this.hintItem.name = "Dear Reviewer: trust the review window's folder";
    this.hintItem.text = "$(workspace-untrusted) Navigation off";
    this.hintItem.tooltip =
      "The review window is in Restricted Mode, so language servers and code navigation are off in its Changes. Click to trust Dear Reviewer's folder of Changes.";
    this.hintItem.command = "dearReviewer.trustReviewWindow";
    this.subscriptions.push(
      this.hintItem,
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.refresh()),
      // The review window may have been trusted while another window had focus.
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) this.refresh();
      })
    );
    this.refresh();
  }

  /**
   * Asks whether to trust the folder, unless the Reviewer was asked before
   * or the review window is known to be trusted. Asks at once, so the
   * question shows while the Change opens, and doesn't wait for the answer.
   */
  askOnce(): void {
    if (this.remembered().asked || this.knownTrusted()) return;
    this.remember({ asked: true });
    const answer = this.ask(
      "Dear Reviewer keeps the Changes you review in a folder the editor doesn't trust yet, so they open in Restricted Mode, with language servers and code navigation off. Trusting the folder turns them on. It also lets the reviewed code's workspace settings and tasks apply, including for pull requests from people you don't know.",
      trustButton,
      notNow
    );
    void Promise.resolve(answer).then((picked) => {
      if (picked === trustButton) return this.trust();
    });
  }

  /**
   * The Trust… flow: copies the folder's path, says what to do with it, and
   * opens Workspace Trust.
   */
  async trust(): Promise<void> {
    await vscode.env.clipboard.writeText(this.storageDir);
    void vscode.window.showInformationMessage(
      "Copied the folder's path. In Workspace Trust, choose Add Folder and paste it."
    );
    await vscode.commands.executeCommand("workbench.trust.manage");
  }

  /** The status-bar hint while it shows, for the tests. */
  hint(): { text: string; tooltip?: string; command?: string } | undefined {
    if (!this.hintShown) return;
    const { text, tooltip, command } = this.hintItem;
    return {
      text,
      tooltip: typeof tooltip === "string" ? tooltip : tooltip?.value,
      command: typeof command === "string" ? command : command?.command,
    };
  }

  /**
   * For the tests, which run with workspace trust off: stands in for the
   * window's trust and for the question, and with `fresh`, forgets the
   * Reviewer's answer.
   */
  async forTests(stand: {
    isTrusted: boolean;
    isReviewWindow?: boolean;
    fresh?: boolean;
    ask?: Ask;
  }): Promise<void> {
    this.isTrusted = () => stand.isTrusted;
    if (stand.isReviewWindow !== undefined) {
      const isReviewWindow = stand.isReviewWindow;
      this.isReviewWindow = () => isReviewWindow;
    }
    if (stand.ask) this.ask = stand.ask;
    if (stand.fresh) fs.rmSync(this.file, { force: true });
    this.refresh();
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
  }

  /**
   * Shows the hint in an untrusted review window and hides it otherwise,
   * and lets the setup walkthrough know once the review window is trusted.
   */
  private refresh(): void {
    // The review window tells the other windows whether it is trusted.
    if (
      this.isReviewWindow() &&
      this.remembered().reviewWindowTrusted !== this.isTrusted()
    )
      this.remember({ reviewWindowTrusted: this.isTrusted() });
    this.hintShown = this.isReviewWindow() && !this.isTrusted();
    if (this.hintShown) this.hintItem.show();
    else this.hintItem.hide();
    void setContext("dearReviewer.reviewWindowTrusted", this.knownTrusted());
  }

  /**
   * Whether the review window is trusted, as far as this window can tell:
   * the review window knows; another window knows only what it last said.
   */
  private knownTrusted(): boolean {
    if (this.isReviewWindow()) return this.isTrusted();
    return this.remembered().reviewWindowTrusted === true;
  }

  private remembered(): Remembered {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8")) as Remembered;
    } catch {
      return {};
    }
  }

  private remember(answer: Remembered): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(
      this.file,
      JSON.stringify({ ...this.remembered(), ...answer }, null, 2)
    );
  }
}
