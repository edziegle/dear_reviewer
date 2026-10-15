// A local Change's Reviews, kept in the extension's storage since no pull
// request holds them (see ADR 0016): the Comments of the Review under way,
// the Brief written for it until the Reviewer copies it (see ADR 0018), and
// the head commit the last Brief covered. Kept by the Change's
// conversation name, which new commits don't change (see ADR 0009), so a
// branch's next Review knows what its last one covered.

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { Change } from "./changeWorkspace";
import type { GitHubUser, ReviewThread, ThreadPlace } from "./github/client";
import type { PendingReviews } from "./pendingReview";

/** A thread of the Review under way on a local Change. */
export interface LocalThread extends ThreadPlace {
  id: string;
  /** The commit of the side's file the thread was written on. */
  commit: string;
  comments: { id: string; body: string; createdAt: string }[];
}

interface LocalReview {
  /** The threads of the Review under way. */
  threads: LocalThread[];
  /** The Brief that ended the last Review. */
  briefed?: { commit: string; at: string };
  /**
   * The Brief written for the Review under way, which ends it once copied,
   * with the ids of the Comments it covered. Those kept before follow-up
   * Comments (see ADR 0024) have the ids of the threads instead.
   */
  written?: {
    file: string;
    commit: string;
    comments?: string[];
    threads?: string[];
  };
}

export class LocalPendingReviews implements PendingReviews {
  private readonly file: string;

  /** `signedIn` names the Comments' author: the Reviewer's GitHub login, once known. */
  constructor(
    storageDir: string,
    private readonly signedIn: () => GitHubUser | undefined
  ) {
    this.file = path.join(storageDir, "local-reviews.json");
  }

  get viewer(): GitHubUser | undefined {
    return this.signedIn();
  }

  /**
   * The threads of the Review under way, on the Change's sides. A thread
   * written on another commit of a side, such as before the branch moved,
   * is outdated.
   */
  async threads(change: Change): Promise<ReviewThread[]> {
    const author = this.viewer ?? { login: "You", avatarUrl: "" };
    return this.pendingThreads(change).map(
      ({ commit, comments, ...thread }) => ({
        ...thread,
        pending: true,
        resolved: false,
        outdated: commit !== sideCommit(change, thread.side),
        comments: comments.map((c) => ({ ...c, author, pending: true })),
      })
    );
  }

  /** The threads of the Review under way, as kept. */
  pendingThreads(change: Change): LocalThread[] {
    return this.all()[change.conversation]?.threads ?? [];
  }

  async addThread(
    change: Change,
    place: ThreadPlace,
    body: string
  ): Promise<{ threadId: string; commentId: string }> {
    const thread: LocalThread = {
      id: crypto.randomUUID(),
      ...place,
      commit: sideCommit(change, place.side),
      comments: [
        {
          id: crypto.randomUUID(),
          body,
          createdAt: new Date().toISOString(),
        },
      ],
    };
    this.update(change, (review) => review.threads.push(thread));
    return { threadId: thread.id, commentId: thread.comments[0].id };
  }

  /** Adds a follow-up Comment to the thread, in the Review under way. */
  async reply(
    change: Change,
    threadId: string,
    body: string
  ): Promise<{ commentId: string; pending: boolean }> {
    const comment = {
      id: crypto.randomUUID(),
      body,
      createdAt: new Date().toISOString(),
    };
    this.update(change, (review) => {
      const thread = review.threads.find((t) => t.id === threadId);
      if (!thread) throw new Error("The thread is no longer there.");
      thread.comments.push(comment);
    });
    return { commentId: comment.id, pending: true };
  }

  async setResolved(): Promise<never> {
    throw new Error("A local Change's threads aren't resolved.");
  }

  async editComment(
    change: Change,
    commentId: string,
    body: string
  ): Promise<void> {
    this.update(change, (review) => {
      const comment = review.threads
        .flatMap((t) => t.comments)
        .find((c) => c.id === commentId);
      if (!comment) throw new Error("The Comment is no longer there.");
      comment.body = body;
    });
  }

  async deleteComment(change: Change, commentId: string): Promise<void> {
    this.update(change, (review) => {
      for (const thread of review.threads)
        thread.comments = thread.comments.filter((c) => c.id !== commentId);
      review.threads = review.threads.filter((t) => t.comments.length > 0);
    });
  }

  /**
   * Keeps the Brief written from these threads at the Change's head. The
   * Review goes on until the Reviewer copies it.
   */
  wroteBrief(change: Change, file: string, briefed: LocalThread[]): void {
    this.update(change, (review) => {
      review.written = {
        file,
        commit: change.headSha,
        comments: briefed.flatMap((t) => t.comments.map((c) => c.id)),
      };
    });
  }

  /**
   * Ends the Review whose Brief is this file, if it is the latest written
   * and the Review hasn't ended: the Comments that went into the Brief leave
   * the Review, with the threads they leave empty, and the head it covered
   * is kept as the last reviewed commit. A follow-up Comment added since
   * stays for the next Brief. Gives the conversation name of the Review it
   * ended.
   */
  endWithBrief(file: string): string | undefined {
    const all = this.all();
    const conversation = Object.keys(all).find(
      (name) => all[name].written?.file === file
    );
    if (conversation === undefined) return;
    const review = all[conversation];
    const written = review.written!;
    const comments = new Set(written.comments);
    const threads = new Set(written.threads);
    for (const thread of review.threads)
      thread.comments = threads.has(thread.id)
        ? []
        : thread.comments.filter((c) => !comments.has(c.id));
    review.threads = review.threads.filter((t) => t.comments.length > 0);
    review.briefed = {
      commit: written.commit,
      at: new Date().toISOString(),
    };
    delete review.written;
    this.write(all);
    return conversation;
  }

  /** Drops the Comments of the Review under way, unbriefed. */
  async discard(change: Change): Promise<number> {
    let count = 0;
    this.update(change, (review) => {
      count = review.threads.reduce((n, t) => n + t.comments.length, 0);
      review.threads = [];
      delete review.written;
    });
    return count;
  }

  /** The head commit the last Brief for the conversation covered, if one was written. */
  lastBriefed(conversation: string): string | undefined {
    return this.all()[conversation]?.briefed?.commit;
  }

  /** The conversation names of the local Reviews kept. */
  names(): string[] {
    return Object.keys(this.all());
  }

  /** Forgets the Review under way and the last Brief of a Change that is over. */
  forget(conversation: string): void {
    const all = this.all();
    if (!(conversation in all)) return;
    delete all[conversation];
    this.write(all);
  }

  private update(change: Change, edit: (review: LocalReview) => void): void {
    const all = this.all();
    const review = all[change.conversation] ?? { threads: [] };
    edit(review);
    all[change.conversation] = review;
    this.write(all);
  }

  private all(): Record<string, LocalReview> {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8")) as Record<
        string,
        LocalReview
      >;
    } catch {
      return {};
    }
  }

  private write(all: Record<string, LocalReview>): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(all, null, 2));
    fs.renameSync(`${this.file}.tmp`, this.file);
  }
}

/** The commit of a side's files: the merge base on the left, the head on the right. */
function sideCommit(change: Change, side: ThreadPlace["side"]): string {
  return side === "LEFT" ? change.mergeBase : change.headSha;
}
