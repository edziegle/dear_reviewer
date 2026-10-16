// Decides when a Change may check GitHub for what changed on the remote
// (ADR 0036): never while another check of it runs, and not again within a
// few seconds of the last, so a burst of focus changes sends one request.
// Pure, so it's tested under plain Node.

/** How long after a check another automatic one is skipped. */
export const minimumGapMs = 5_000;

export class RefreshGate {
  /** Shortened by tests, which can't wait out the real gap. */
  gapMs = minimumGapMs;

  private readonly running = new Set<string>();
  private readonly lastStart = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Starts a check of the key and gives how to end it, or gives nothing if
   * one runs already or, for an automatic one, the last began too recently.
   * A check the Reviewer asked for skips only the overlap.
   */
  begin(key: string, automatic: boolean): (() => void) | undefined {
    if (this.running.has(key)) return;
    const last = this.lastStart.get(key);
    if (automatic && last !== undefined && this.now() - last < this.gapMs)
      return;
    this.running.add(key);
    this.lastStart.set(key, this.now());
    return () => void this.running.delete(key);
  }

  /** Forgets a key whose Change is closed. */
  forget(key: string): void {
    this.running.delete(key);
    this.lastStart.delete(key);
  }
}

/** What a check found, in words: "2 new commits", or "Up to date". */
export function foundText(found: {
  newCommits: number | "some";
  threads: number;
}): string {
  const parts: string[] = [];
  if (found.newCommits === "some") parts.push("New commits");
  else if (found.newCommits > 0)
    parts.push(
      `${found.newCommits} new ${found.newCommits === 1 ? "commit" : "commits"}`
    );
  if (found.threads > 0)
    parts.push(
      `${found.threads} new ${found.threads === 1 ? "thread" : "threads"}`
    );
  return parts.length > 0 ? parts.join(", ") : "Up to date";
}

/** Whether GitHub's commit id is one, since it is handed to git. */
export function isCommitId(value: unknown): value is string {
  return (
    typeof value === "string" && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(value)
  );
}

/** Whether a branch name from GitHub is safe to build a git ref from: no leading `-`, no `..`, no `.lock` part. */
export function isSafeBranchName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9._/-]+$/.test(value) &&
    !value.startsWith("-") &&
    !value.startsWith("/") &&
    !value.endsWith("/") &&
    !value.includes("..") &&
    !value.includes("//") &&
    !value
      .split("/")
      .some((part) => part.endsWith(".lock") || part.startsWith("."))
  );
}
