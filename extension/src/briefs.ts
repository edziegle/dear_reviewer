// Ends a local Change's Review with a Brief (see ADR 0016): the Assistant
// turns the Reviewer's Comments into instructions an agent can act on, which
// open as a Markdown file in the editor, where the Reviewer reads and edits
// them. Copying the Brief to the clipboard ends the Review (see ADR 0018).
// The overview shows each step of it, writing, written and copied, instead
// of notifications (see ADR 0034).

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { Change, changeName } from "./changeWorkspace";
import type { LocalPendingReviews, LocalThread } from "./localReviews";
import { messageOf } from "./errors";

/** Where a local Change's Brief stands, for its overview. */
export interface BriefState {
  /** The Assistant is writing it, it is written and waits to be copied, it couldn't be written, or it was copied. */
  phase: "writing" | "written" | "problem" | "ended";
  /** How many Comments it covers. */
  comments: number;
  /** Why it couldn't be written, in words for the Reviewer. */
  problem?: string;
  /** Whether its file is there to show. */
  canShow: boolean;
}

export class Briefs {
  private readonly dir: string;
  private readonly writing = new Map<string, number>();
  private readonly problems = new Map<string, string>();
  /** The Changes whose Brief had no Comments to be written from. */
  private readonly empty = new Set<string>();
  private readonly changed = new vscode.EventEmitter<void>();
  /** Fires when a Brief starts or stops being written, or fails. */
  readonly onDidChange = this.changed.event;

  /**
   * `write` has the Assistant write a Brief from the threads, and `ended`
   * lets the rest of Dear Reviewer know that the Review of the Change with
   * this conversation name ended.
   */
  constructor(
    storageDir: string,
    private readonly local: LocalPendingReviews,
    private readonly assistant: (
      change: Change,
      threads: LocalThread[]
    ) => Promise<string>,
    private readonly ended: (conversation: string) => Promise<void>,
    /** The column the Brief's file opens in: the Change's code column. */
    private readonly column: (change: Change) => vscode.ViewColumn
  ) {
    this.dir = path.join(storageDir, "briefs");
  }

  /**
   * Has the Assistant write a Brief from the Comments of the Review under
   * way, at the Change's head, and opens it in the editor. The Review goes on
   * until the Reviewer copies the Brief. Gives the Brief's file, if one was
   * written.
   */
  async write(change: Change): Promise<vscode.Uri | undefined> {
    const name = changeName(change);
    const threads = this.local.pendingThreads(change);
    const conversation = change.conversation;
    this.problems.delete(conversation);
    this.empty.delete(conversation);
    if (threads.length === 0) {
      this.empty.add(conversation);
      this.problems.set(
        conversation,
        "There are no Comments to write a Brief from. Comment in the diff first."
      );
      this.changed.fire();
      return;
    }
    let text: string;
    this.writing.set(conversation, threads.length);
    this.changed.fire();
    try {
      text = await this.assistant(change, threads);
    } catch (err) {
      this.problems.set(
        conversation,
        `Couldn't write a Brief for ${name}: ${messageOf(err)}`
      );
      return;
    } finally {
      this.writing.delete(conversation);
      this.changed.fire();
    }
    const file = path.join(
      this.dirOf(change.conversation),
      `Brief ${name.replace(/[^\w.-]+/g, "-")} ${change.headSha.slice(0, 7)}.md`
    );
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    this.local.wroteBrief(change, file, threads);
    this.changed.fire();
    return this.show(change, file);
  }

  /** Opens the Brief's file, the one written for the Review under way or else the last one copied, in the Change's code column. */
  async show(
    change: Change,
    file = this.local.writtenBrief(change.conversation)?.file ??
      this.local.lastBrief(change.conversation)?.file
  ): Promise<vscode.Uri | undefined> {
    if (!file || !fs.existsSync(file)) return;
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(file)
    );
    await vscode.window.showTextDocument(document, {
      preview: false,
      viewColumn: this.column(change),
    });
    return document.uri;
  }

  /** Copies the Brief written for the Change's Review under way, which ends it. */
  async copyWritten(change: Change): Promise<void> {
    const written = this.local.writtenBrief(change.conversation);
    if (written) await this.copy(vscode.Uri.file(written.file));
  }

  /** Where the Change's Brief stands, if it is a local Change with one under way or copied. */
  stateOf(change: Change): BriefState | undefined {
    if (change.pullRequest) return;
    const conversation = change.conversation;
    const writing = this.writing.get(conversation);
    if (writing !== undefined)
      return { phase: "writing", comments: writing, canShow: false };
    const problem = this.problems.get(conversation);
    // The reason there were no Comments no longer holds once there are some.
    if (
      problem &&
      !(
        this.empty.has(conversation) &&
        this.local.pendingThreads(change).length > 0
      )
    )
      return { phase: "problem", comments: 0, problem, canShow: false };
    const written = this.local.writtenBrief(conversation);
    if (written)
      return {
        phase: "written",
        comments: written.comments,
        canShow: fs.existsSync(written.file),
      };
    const last = this.local.lastBrief(conversation);
    if (last && last.commit === change.headSha)
      return {
        phase: "ended",
        comments: last.comments ?? 0,
        canShow: !!last.file && fs.existsSync(last.file),
      };
  }

  /**
   * Copies the Brief, with any edits not yet saved, to the clipboard: the
   * one given, or else the active editor's. Copying the latest Brief of a
   * Review under way ends that Review.
   */
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
    const ended = this.local.endWithBrief(target.fsPath);
    if (ended !== undefined) await this.ended(ended);
    // Copying the Brief of a Review under way shows in its overview; an
    // older Brief has no Review to show it, so a notification says so.
    if (ended === undefined)
      void vscode.window.showInformationMessage(
        "Copied the Brief. Paste it into the agent session that should act on it."
      );
  }

  dispose(): void {
    this.changed.dispose();
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
