// Each Change's Assistant conversation, kept in the extension's storage so it
// outlasts the window and the Change's worktrees: the Claude session to
// resume, the messages the panel shows, the head they were about, and what
// the Change's overview shows from the Assistant. Kept
// by the Change's conversation name, which new commits don't change (ADR 0009).

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { Message } from "./panel";

export interface SavedConversation {
  /** The Claude session, for `claude --resume`. */
  sessionId: string;
  /** The head commit the conversation last talked about. */
  headSha: string;
  messages: Message[];
  /** The Assistant's summary of the Change, which its overview shows. */
  summary?: string;
  /**
   * The commits whose changes since the last Review the Assistant last
   * explained, and what it said, which the overview shows.
   */
  sinceLastReview?: { from: string; to: string; text?: string };
}

export class Conversations {
  private readonly file: string;
  private readonly dirs: string;

  constructor(storageDir: string) {
    this.file = path.join(storageDir, "assistant", "conversations.json");
    this.dirs = path.join(storageDir, "assistant", "sessions");
  }

  get(name: string): SavedConversation | undefined {
    return this.all()[name];
  }

  put(name: string, conversation: SavedConversation): void {
    this.write({ ...this.all(), [name]: conversation });
  }

  /** The names of every saved conversation. */
  names(): string[] {
    return Object.keys(this.all());
  }

  forget(name: string): void {
    const all = this.all();
    delete all[name];
    this.write(all);
  }

  /**
   * The folder `claude` runs in for this conversation. Claude Code keeps a
   * session under the folder it ran in and resumes it only from there, so
   * the folder must stay the same while the worktrees come and go.
   */
  workingDirectory(name: string): string {
    const dir = path.join(
      this.dirs,
      crypto.createHash("sha256").update(name).digest("hex").slice(0, 16)
    );
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  private all(): Record<string, SavedConversation> {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8")) as Record<
        string,
        SavedConversation
      >;
    } catch {
      return {};
    }
  }

  private write(all: Record<string, SavedConversation>): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(all, null, 2));
    fs.renameSync(`${this.file}.tmp`, this.file);
  }
}
