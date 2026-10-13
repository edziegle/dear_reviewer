// Which of a Change's files the Reviewer has marked viewed.

import * as fs from "fs";
import * as path from "path";
import type { Change } from "./openChanges";

/**
 * Viewed state for a Change's files, by path relative to the repository root.
 * Local Changes keep it in the extension's storage; pull requests can keep it
 * on GitHub behind the same interface.
 */
export interface ViewedFiles {
  viewed(change: Change): Promise<ReadonlySet<string>>;
  setViewed(change: Change, paths: string[], viewed: boolean): Promise<void>;
  /** Drops what's kept for a Change that has been closed. */
  forget(change: Change): Promise<void>;
}

/**
 * Keeps viewed files in a file in the extension's storage, so they survive
 * reloads and every window sees the same state.
 */
export class LocalViewedFiles implements ViewedFiles {
  private readonly file: string;

  constructor(storageDir: string) {
    this.file = path.join(storageDir, "viewed-files.json");
  }

  async viewed(change: Change): Promise<ReadonlySet<string>> {
    return new Set(this.read()[change.id] ?? []);
  }

  async setViewed(
    change: Change,
    paths: string[],
    viewed: boolean
  ): Promise<void> {
    const all = this.read();
    const files = new Set(all[change.id] ?? []);
    for (const p of paths) {
      if (viewed) files.add(p);
      else files.delete(p);
    }
    all[change.id] = [...files].sort();
    if (files.size === 0) delete all[change.id];
    this.write(all);
  }

  async forget(change: Change): Promise<void> {
    const all = this.read();
    delete all[change.id];
    this.write(all);
  }

  private read(): Record<string, string[]> {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8")) as Record<
        string,
        string[]
      >;
    } catch {
      return {};
    }
  }

  private write(all: Record<string, string[]>): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(all, null, 2));
  }
}
