// Workspace trust for the review window. Its folders, the Changes'
// worktrees, live in Dear Reviewer's storage, which the editor doesn't
// trust until the Reviewer says so; until then language servers, and with
// them navigation, stay off (see ADR 0010, ADR 0021). Trusting it is a real
// trade-off, so VS Code's own prompt asks once, the first time the review
// window opens. The review window's first folder holds every Change, so its
// Trust also covers the Changes opened later. No API grants trust, so after
// that Dear Reviewer only takes the Reviewer to Workspace Trust in the review
// window, where one click trusts it, and shows a quiet hint there meanwhile.

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { setContext } from "./context";

/** What every window, and the next start, needs to know. */
interface Remembered {
  /** Whether the review window was trusted when it last said. */
  reviewWindowTrusted?: boolean;
  /** Whether another window asked the review window to show Workspace Trust. */
  showWorkspaceTrust?: boolean;
}

export class ReviewWindowTrust implements vscode.Disposable {
  private isTrusted = () => vscode.workspace.isTrusted;
  private showWorkspaceTrust = () =>
    vscode.commands.executeCommand("workbench.trust.manage");
  private readonly file: string;
  private hintShown = false;
  private readonly hintItem: vscode.StatusBarItem;
  private readonly subscriptions: vscode.Disposable[] = [];

  /** Keeps what windows tell each other in `trust.json` in the storage folder. */
  constructor(
    storageDir: string,
    private isReviewWindow: () => boolean,
    private readonly showReviewWindow: () => Promise<void>
  ) {
    this.file = path.join(storageDir, "trust.json");
    this.hintItem = vscode.window.createStatusBarItem(
      "dearReviewer.trustHint",
      vscode.StatusBarAlignment.Left
    );
    this.hintItem.name = "Dear Reviewer: trust the review window";
    this.hintItem.text = "$(workspace-untrusted) Navigation off";
    this.hintItem.tooltip =
      "The review window is in Restricted Mode, so language servers and code navigation are off in its Changes. Click to trust the review window.";
    this.hintItem.command = "dearReviewer.trustReviewWindow";
    this.subscriptions.push(
      this.hintItem,
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.refresh()),
      // The review window may have been trusted, or asked to show Workspace
      // Trust, while another window had focus.
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) this.refresh();
      })
    );
    this.refresh();
  }

  /**
   * Shows Workspace Trust in the review window, where its Trust button
   * trusts the review window and every Change it opens later. From another
   * window, brings up the review window, which shows it.
   */
  async trust(): Promise<void> {
    if (this.isReviewWindow()) {
      await this.showWorkspaceTrust();
      return;
    }
    this.remember({ showWorkspaceTrust: true });
    await this.showReviewWindow();
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
   * window's trust, for whether it is the review window, and for showing
   * Workspace Trust.
   */
  async forTests(stand: {
    isTrusted: boolean;
    isReviewWindow?: boolean;
    showWorkspaceTrust?: () => void;
  }): Promise<void> {
    this.isTrusted = () => stand.isTrusted;
    if (stand.isReviewWindow !== undefined) {
      const isReviewWindow = stand.isReviewWindow;
      this.isReviewWindow = () => isReviewWindow;
    }
    const show = stand.showWorkspaceTrust;
    if (show) this.showWorkspaceTrust = async () => show();
    this.refresh();
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
  }

  /**
   * Shows the hint in an untrusted review window and hides it otherwise,
   * lets the setup walkthrough know once the review window is trusted, and
   * shows Workspace Trust there if another window asked for it.
   */
  private refresh(): void {
    if (this.isReviewWindow()) {
      // The review window tells the other windows whether it is trusted.
      const remembered = this.remembered();
      if (remembered.reviewWindowTrusted !== this.isTrusted())
        this.remember({ reviewWindowTrusted: this.isTrusted() });
      if (remembered.showWorkspaceTrust) {
        this.remember({ showWorkspaceTrust: false });
        if (!this.isTrusted()) void this.showWorkspaceTrust();
      }
    }
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

  private remember(update: Remembered): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(
      this.file,
      JSON.stringify({ ...this.remembered(), ...update }, null, 2)
    );
  }
}
