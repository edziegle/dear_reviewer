// The Changes that are open, kept in a file in the extension's storage so
// every window, and the next session, sees the same list. The list runs in
// the order the Changes were last shown: putting one again moves it last.

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
  /**
   * Names the Change across new commits, which give it a new id: the pull
   * request, or else the branch or the commit range opened. Its Assistant
   * conversation is kept under this name (see ADR 0009).
   */
  conversation: string;
}

export interface OpenChange extends Change {
  /** Whether its folders are in the review window rather than the Reviewer's own. */
  inReviewWindow: boolean;
  /** Set while the Change waits for the review window to show its diff. */
  diffPending?: boolean;
}

export interface OpenChangesTiming {
  /** How long a change waits for another window's lock before it fails. */
  waitMs?: number;
  /** How old a lock gets before it is taken over even if its window lives. */
  staleMs?: number;
}

export class OpenChanges {
  /** The file every window reads and writes the open Changes in. */
  readonly file: string;
  private readonly lockFile: string;
  private readonly waitMs: number;
  private readonly staleMs: number;

  constructor(storageDir: string, timing: OpenChangesTiming = {}) {
    this.file = path.join(storageDir, "open-changes.json");
    this.lockFile = `${this.file}.lock`;
    this.waitMs = timing.waitMs ?? 10_000;
    this.staleMs = timing.staleMs ?? 5_000;
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

  /** Adds the Change, or updates it, as the one shown last. */
  put(change: OpenChange): void {
    this.update((changes) => [
      ...changes.filter((c) => c.id !== change.id),
      change,
    ]);
  }

  remove(id: string): void {
    this.removeAll([id]);
  }

  /** Removes these Changes in one write, so other windows see them go at once. */
  removeAll(ids: Iterable<string>): void {
    const gone = new Set(ids);
    this.update((changes) => changes.filter((c) => !gone.has(c.id)));
  }

  /**
   * Marks these Changes' diffs shown, each where it is, so a Change opened
   * after them stays in front.
   */
  markShown(ids: Iterable<string>): void {
    const shown = new Set(ids);
    this.update((changes) =>
      changes.map((c) => (shown.has(c.id) ? { ...c, diffPending: false } : c))
    );
  }

  /**
   * Reads the list, changes it and writes it back while holding the lock, so
   * no other window's change lands in between. Fails rather than writes over
   * a list it can't read.
   */
  private update(edit: (changes: OpenChange[]) => OpenChange[]): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.locked(() => {
      let current: OpenChange[] = [];
      try {
        current = JSON.parse(
          fs.readFileSync(this.file, "utf8")
        ) as OpenChange[];
        if (!Array.isArray(current)) throw new Error("not a list");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw new Error(
            `The open Changes in ${this.file} can't be read, so they were not changed: ${error}`
          );
        }
      }
      this.replaceFile(edit(current));
    });
  }

  /** Writes beside the file and renames over it, so a read never sees half a list. */
  private replaceFile(changes: OpenChange[]): void {
    const temporary = `${this.file}.${process.pid}.tmp`;
    try {
      const handle = fs.openSync(temporary, "w");
      try {
        fs.writeSync(handle, JSON.stringify(changes, null, 2));
        fs.fsyncSync(handle);
      } finally {
        fs.closeSync(handle);
      }
      fs.renameSync(temporary, this.file);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }

  private locked(work: () => void): void {
    const deadline = Date.now() + this.waitMs;
    const token = `${process.pid}:${Math.random().toString(36).slice(2)}`;
    while (!this.tryLock(token)) {
      if (Date.now() >= deadline) {
        throw new Error(
          `Another window holds the lock on the open Changes (${this.lockFile}); gave up waiting`
        );
      }
      sleep(10);
    }
    try {
      work();
    } finally {
      // Only our own lock: if we were slow and it was taken over, the lock
      // now belongs to another window.
      if (this.readLock() === token) fs.rmSync(this.lockFile, { force: true });
    }
  }

  private readLock(): string | undefined {
    try {
      return fs.readFileSync(this.lockFile, "utf8");
    } catch {
      return undefined;
    }
  }

  /** Takes the lock if it's free, or if the window holding it is gone or stuck. */
  private tryLock(token: string): boolean {
    // Linking a finished file into place makes the lock appear complete or
    // not at all, so no window reads it half-written and takes it for stale.
    const pending = `${this.lockFile}.${token.replace(":", ".")}.pending`;
    fs.writeFileSync(pending, token);
    try {
      fs.linkSync(pending, this.lockFile);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    } finally {
      fs.rmSync(pending, { force: true });
    }
    this.takeOverIfStale();
    return false;
  }

  private takeOverIfStale(): void {
    let holder: string;
    let ageMs: number;
    try {
      holder = fs.readFileSync(this.lockFile, "utf8");
      ageMs = Date.now() - fs.statSync(this.lockFile).mtimeMs;
    } catch {
      return;
    }
    if (ageMs < this.staleMs && processIsAlive(Number(holder.split(":")[0])))
      return;
    // Renaming is atomic, so of several windows taking over one lock only one
    // gets it; the rest find it gone.
    const taken = `${this.lockFile}.${process.pid}.stale`;
    try {
      fs.renameSync(this.lockFile, taken);
    } catch {
      return;
    }
    // A lock that changed hands since it was read isn't stale: put it back, if
    // no other window has taken the free lock in the meantime.
    if (fs.readFileSync(taken, "utf8") !== holder) {
      try {
        fs.linkSync(taken, this.lockFile);
      } catch {
        // someone else has already taken a new lock
      }
    }
    fs.rmSync(taken, { force: true });
  }
}

/** Blocks the thread, since the store's interface is synchronous. */
function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * The Change in front (ADR 0025): of those whose folders are here and whose
 * diff has been shown, the one shown last. When it closes, the one shown
 * before it comes to the front.
 */
export function changeInFront<T extends OpenChange>(
  changes: readonly T[],
  isHere: (change: T) => boolean
): T | undefined {
  return changes
    .filter((change) => !change.diffPending && isHere(change))
    .at(-1);
}

/**
 * The Changes waiting for their diff whose folders have arrived here, in the
 * order they were opened, and whether each is to show the way a review
 * starts. One opened before a Change already shown here, whose folders
 * arrived later, stays behind that one rather than taking the front.
 */
export function arrivedDiffs<T extends OpenChange>(
  changes: readonly T[],
  isHere: (change: T) => boolean
): { change: T; show: boolean }[] {
  return changes.flatMap((change, i) =>
    change.diffPending && isHere(change)
      ? [
          {
            change,
            show: !changes
              .slice(i + 1)
              .some((later) => !later.diffPending && isHere(later)),
          },
        ]
      : []
  );
}

/**
 * Whether the review window still has a Change sent to it to show: one
 * waiting for its diff whose folders the review window's workspace file
 * lists, so they are on their way. One whose folders were never sent, or
 * were taken out, won't arrive, so it doesn't count.
 */
export function waitingToShow(
  changes: readonly OpenChange[],
  listedFolders: readonly string[]
): boolean {
  const listed = new Set(listedFolders);
  return changes.some(
    (c) =>
      c.inReviewWindow &&
      c.diffPending &&
      listed.has(c.baseDir) &&
      listed.has(c.headDir)
  );
}
