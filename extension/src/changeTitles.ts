// The titles of the pull requests the open Changes come from, learned when a
// pull request loads. A Change carries no title of its own (ADR 0020 names
// it by the pull request or branch), so the views that show a Change learn
// its title here. Kept by conversation name, so a newer head of the same pull
// request keeps the title. Kept apart from `vscode` so the unit tests can
// run it under plain Node.

import type { Change } from "./openChanges";

export class ChangeTitles {
  private readonly titles = new Map<string, string>();
  private readonly listeners = new Set<() => void>();

  /** The title of the Change's pull request, once it has loaded. */
  of(change: Pick<Change, "conversation">): string | undefined {
    return this.titles.get(change.conversation);
  }

  /** Remembers the title and tells the listeners, unless it is the one already known. */
  set(change: Pick<Change, "conversation">, title: string): void {
    const trimmed = title.trim();
    if (!trimmed || this.titles.get(change.conversation) === trimmed) return;
    this.titles.set(change.conversation, trimmed);
    for (const listener of this.listeners) listener();
  }

  /** Calls `listener` when a title is learned or changes; gives the way to stop. */
  onDidChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
