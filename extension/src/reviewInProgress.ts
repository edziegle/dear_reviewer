// Which files have a Review in progress: those of the Changes with pending
// Comments, a pull request's pending review (see ADR 0007) or a local
// Change's Comments awaiting a Brief (see ADR 0016). A new thread's button
// reads Add Review Comment on them, and Start Review elsewhere, so the
// Reviewer knows their Comment waits for the Review rather than publishing.

import * as path from "path";
import * as vscode from "vscode";
import { changedFiles, type Change, type ChangedFile } from "./changeWorkspace";
import { setContext } from "./context";

export class ReviewInProgressFiles implements vscode.Disposable {
  private readonly files = new Map<string, Promise<ChangedFile[]>>();
  private shown: readonly string[] = [];
  private loads = 0;
  private readonly subscription: vscode.Disposable;

  constructor(
    private readonly openChanges: () => Change[],
    private readonly pendingCount: (change: Change) => number,
    onDidChangeComments: vscode.Event<void>
  ) {
    this.subscription = onDidChangeComments(() => void this.refresh());
    void setContext("dearReviewer.reviewInProgressFiles", this.shown);
  }

  dispose(): void {
    this.subscription.dispose();
  }

  /**
   * Both sides of every changed file, as `resourcePath` gives them, of the
   * Changes with a Review in progress, as last shown to the
   * `dearReviewer.reviewInProgressFiles` context key.
   */
  get paths(): readonly string[] {
    return this.shown;
  }

  private async refresh(): Promise<void> {
    const load = ++this.loads;
    const paths = await Promise.all(
      this.openChanges()
        .filter((change) => this.pendingCount(change) > 0)
        .map(async (change) => {
          const files = await this.filesOf(change).catch(
            (): ChangedFile[] => []
          );
          return files.flatMap((file) =>
            [change.baseDir, change.headDir].map((dir) =>
              path.join(dir, ...file.path.split("/"))
            )
          );
        })
    );
    // A later refresh has newer state.
    if (load !== this.loads) return;
    this.shown = paths.flat();
    await setContext("dearReviewer.reviewInProgressFiles", this.shown);
  }

  private filesOf(change: Change): Promise<ChangedFile[]> {
    const key = `${change.id}\0${change.mergeBase}\0${change.headSha}`;
    let files = this.files.get(key);
    if (!files) {
      files = changedFiles(change);
      files.catch(() => this.files.delete(key));
      this.files.set(key, files);
    }
    return files;
  }
}
