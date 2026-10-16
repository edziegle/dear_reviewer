// The pull requests the Reviewer set aside in Waiting on you. They're kept in
// a file in the extension's storage, so they survive reloads and every
// window sees the same ones. Nothing here asks GitHub.

import * as fs from "fs";
import * as path from "path";

export class IgnoredPullRequests {
  constructor(private readonly file: string) {}

  /** The ids of the pull requests set aside. */
  ids(): Set<string> {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return new Set(
        Array.isArray(parsed)
          ? parsed.filter((id): id is string => typeof id === "string")
          : []
      );
    } catch {
      return new Set();
    }
  }

  ignore(id: string): void {
    this.write(this.ids().add(id));
  }

  restore(id: string): void {
    const ids = this.ids();
    if (ids.delete(id)) this.write(ids);
  }

  /** Forgets every pull request not in `present`, such as the ones that merged or closed. */
  keepOnly(present: Iterable<string>): void {
    const keep = new Set(present);
    const ids = this.ids();
    const kept = new Set([...ids].filter((id) => keep.has(id)));
    if (kept.size !== ids.size) this.write(kept);
  }

  private write(ids: Set<string>): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    // Renamed into place, so another window never reads half a file.
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify([...ids]));
    fs.renameSync(`${this.file}.tmp`, this.file);
  }
}
