// The Changes that are open, kept in a file in the extension's storage so
// every window, and the next session, sees the same list.

import * as fs from "fs";
import * as path from "path";

/** A GitHub pull request, by its repository (owner/name) and number. */
export interface PullRequestRef {
  repository: string;
  number: number;
}

export interface Change {
  id: string;
  /** The local repository the worktrees belong to. */
  repository: string;
  mergeBase: string;
  headSha: string;
  baseDir: string;
  headDir: string;
  /** The pull request the Change comes from; absent for a local Change. */
  pullRequest?: PullRequestRef;
}

export interface OpenChange extends Change {
  /** Whether its folders are in the review window rather than the Reviewer's own. */
  inReviewWindow: boolean;
  /** Set while the Change waits for the review window to show its diff. */
  diffPending?: boolean;
}

export class OpenChanges {
  private readonly file: string;

  constructor(storageDir: string) {
    this.file = path.join(storageDir, "open-changes.json");
  }

  all(): OpenChange[] {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8")) as OpenChange[];
    } catch {
      return [];
    }
  }

  get(id: string): OpenChange | undefined {
    return this.all().find((change) => change.id === id);
  }

  put(change: OpenChange): void {
    this.write([...this.all().filter((c) => c.id !== change.id), change]);
  }

  remove(id: string): void {
    this.write(this.all().filter((c) => c.id !== id));
  }

  private write(changes: OpenChange[]): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(changes, null, 2));
  }
}
