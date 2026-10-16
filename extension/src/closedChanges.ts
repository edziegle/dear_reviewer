// Which open Changes left the list every window shares since this window last
// looked, so it can let go of what it holds for them. Pure, so it's tested
// under plain Node.

export class ClosedChanges<T extends { id: string }> {
  /** The Changes the last sync saw; none before the first, which lets go of nothing. */
  private seen: Map<string, T> | undefined;

  /** The Changes in the last list whose ids aren't in `now`, the list now. */
  leftSince(now: readonly T[]): T[] {
    const ids = new Set(now.map((change) => change.id));
    const left = [...(this.seen?.values() ?? [])].filter(
      (change) => !ids.has(change.id)
    );
    this.seen = new Map(now.map((change) => [change.id, change]));
    return left;
  }
}
