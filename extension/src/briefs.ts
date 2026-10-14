// Ends a local Change's Review with a Brief (see ADR 0016): the Assistant
// turns the Reviewer's Comments into instructions an agent can act on, which
// open as a Markdown file in the editor, where the Reviewer reads and edits
// them before copying them to the clipboard.

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { Change, changeName } from "./changeWorkspace";
import type { LocalPendingReviews, LocalThread } from "./localReviews";
import { messageOf } from "./errors";

export class Briefs {
  private readonly dir: string;

  /**
   * `write` has the Assistant write a Brief from the threads, and `ended`
   * lets the rest of Dear Reviewer know that the Change's Review ended.
   */
  constructor(
    storageDir: string,
    private readonly local: LocalPendingReviews,
    private readonly assistant: (
      change: Change,
      threads: LocalThread[]
    ) => Promise<string>,
    private readonly ended: (change: Change) => Promise<void>
  ) {
    this.dir = path.join(storageDir, "briefs");
  }

  /**
   * Has the Assistant write a Brief from the Comments of the Review under
   * way, which ends the Review at the Change's head, and opens the Brief in
   * the editor. Gives the Brief's file, if one was written.
   */
  async write(change: Change): Promise<vscode.Uri | undefined> {
    const name = changeName(change);
    const threads = this.local.pendingThreads(change);
    if (threads.length === 0) {
      void vscode.window.showInformationMessage(
        `There are no Comments on ${name} to write a Brief from. Comment in the gutter of its diff first.`
      );
      return;
    }
    let text: string;
    try {
      text = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `The Assistant is writing a Brief for ${name}…`,
        },
        () => this.assistant(change, threads)
      );
    } catch (err) {
      const message = messageOf(err);
      void vscode.window.showErrorMessage(
        `Couldn't write a Brief for ${name}: ${message}`
      );
      return;
    }
    const file = path.join(
      this.dirOf(change.conversation),
      `Brief ${name.replace(/[^\w.-]+/g, "-")} ${change.headSha.slice(0, 7)}.md`
    );
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    this.local.endWithBrief(change, threads);
    await this.ended(change);
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(file)
    );
    await vscode.window.showTextDocument(document, { preview: false });
    const copy = "Copy Brief";
    void vscode.window
      .showInformationMessage(
        `The Brief for ${name} ends this Review. Read and edit it, then copy it for the agent.`,
        copy
      )
      .then((picked) => {
        if (picked === copy) return this.copy(document.uri);
      });
    return document.uri;
  }

  /** Copies the Brief, with any edits not yet saved, to the clipboard: the one given, or else the active editor's. */
  async copy(uri?: vscode.Uri): Promise<void> {
    uri ??= vscode.window.activeTextEditor?.document.uri;
    if (!uri || !this.isBrief(uri)) {
      void vscode.window.showInformationMessage(
        "Open a Brief in the editor to copy it."
      );
      return;
    }
    const target = uri;
    const open = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === target.toString()
    );
    const text = open?.getText() ?? fs.readFileSync(target.fsPath, "utf8");
    await vscode.env.clipboard.writeText(text);
    void vscode.window.showInformationMessage(
      "Copied the Brief. Paste it into the agent session that should act on it."
    );
  }

  /** Deletes the Briefs of a Change that is over. */
  forget(conversation: string): void {
    fs.rmSync(this.dirOf(conversation), { recursive: true, force: true });
  }

  /** Where the Briefs of a Change are kept, by its conversation name. */
  private dirOf(conversation: string): string {
    return path.join(
      this.dir,
      crypto
        .createHash("sha256")
        .update(conversation)
        .digest("hex")
        .slice(0, 16)
    );
  }

  private isBrief(uri: vscode.Uri): boolean {
    return uri.scheme === "file" && uri.fsPath.startsWith(this.dir + path.sep);
  }
}
