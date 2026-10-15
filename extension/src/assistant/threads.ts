// The Change's review threads as the Assistant reads them: a JSON file in
// the Change's Assistant folder, rewritten whenever the threads load or
// change, and the threads on the lines of a selection sent with a message
// (see ADR 0023).

import * as fs from "fs";
import * as path from "path";
import type * as vscode from "vscode";
import { assistantDir, type Change } from "../changeDetails";
import type { ReviewThread } from "../github/client";
import type { Selection } from "./prompts";

/** A review thread of the Change as it stands, published, pending or local. */
export type ThreadInChange = Omit<
  ReviewThread,
  "id" | "pending" | "comments"
> & {
  comments: {
    author: { login: string };
    body: string;
    /** The Reviewer's own, not yet published: in their pending review, or a local Change's. */
    pending: boolean;
  }[];
};

/** Lines counted from 1. */
interface Lines {
  start: number;
  end: number;
}

/** A thread as the file and prompts give it to the Assistant. */
export interface ThreadForAssistant {
  /** Relative to the repository root, with forward slashes. */
  path: string;
  side: "base" | "head";
  /** Where it is now, or null when its lines are gone from the side. */
  lines: Lines | null;
  /** Where it was written. */
  originalLines: Lines;
  outdated: boolean;
  resolved: boolean;
  comments: { author: string; body: string; pending: boolean }[];
}

export function threadsForAssistant(
  threads: ThreadInChange[]
): ThreadForAssistant[] {
  return threads.map((thread) => {
    const shown = { start: thread.startLine ?? thread.line, end: thread.line };
    const original = thread.original
      ? {
          start: thread.original.startLine ?? thread.original.line,
          end: thread.original.line,
        }
      : shown;
    return {
      path: thread.path,
      side: thread.side === "LEFT" ? "base" : "head",
      // An outdated thread GitHub didn't move shows where it was written.
      lines: thread.outdated && !thread.original ? null : shown,
      originalLines: original,
      outdated: thread.outdated,
      resolved: thread.resolved,
      comments: thread.comments.map((c) => ({
        author: c.author.login,
        body: c.body,
        pending: c.pending,
      })),
    };
  });
}

/** Where the Assistant reads the Change's threads. */
export function threadsFile(change: Change): string {
  return path.join(assistantDir(change), "threads.json");
}

/**
 * The threads on a selection's lines, where the Reviewer sees them: on the
 * same side, at the lines the gutter shows them on.
 */
export function threadsOnLines(
  threads: ThreadInChange[],
  selection: Selection
): ThreadInChange[] {
  if (selection.side === "commit") return [];
  const side = selection.side === "base" ? "LEFT" : "RIGHT";
  return threads.filter(
    (thread) =>
      thread.side === side &&
      thread.path === selection.path &&
      (thread.startLine ?? thread.line) <= selection.endLine &&
      selection.startLine <= thread.line
  );
}

/**
 * Keeps each shown Change's threads file current: rewritten, whole, each
 * time the threads change.
 */
export class ThreadsFiles implements vscode.Disposable {
  private readonly subscription: vscode.Disposable;
  private writing: Promise<void> = Promise.resolve();
  private scheduled = false;

  constructor(
    private readonly changes: () => Change[],
    private readonly threadsOf: (change: Change) => ThreadInChange[],
    onDidChange: vscode.Event<void>
  ) {
    this.subscription = onDidChange(() => this.schedule());
  }

  dispose(): void {
    this.subscription.dispose();
  }

  /** Threads loading fire many changes at once; they make one write. */
  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    this.writing = this.writing.then(async () => {
      this.scheduled = false;
      for (const change of this.changes()) {
        // A closed Change's folder is gone, and stays gone.
        if (!fs.existsSync(change.headDir)) continue;
        const threads = threadsForAssistant(this.threadsOf(change));
        try {
          await writeAtomically(
            threadsFile(change),
            JSON.stringify(threads, null, 2)
          );
        } catch {
          // The next change tries again; the Assistant reads the last file.
        }
      }
    });
  }
}

/**
 * Writes beside the file and renames it into place, so no reader sees half
 * of it. Only the Reviewer's user may read it: it holds unpublished Comments.
 */
export async function writeAtomically(
  file: string,
  text: string
): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.promises.writeFile(temporary, text, { mode: 0o600 });
  await fs.promises.rename(temporary, file);
}
