// Formatting-only marks (ADR 0048), found in the background. Opening a Change
// never waits for them: `FormattingMarks` looks at the files git says were
// modified or moved, sends each pair of versions to a worker thread to parse
// and compare, and tells the views when it has marks to show. Every failure,
// from a file too large to a worker that crashed, is no mark.

import { spawn } from "child_process";
import { Worker } from "worker_threads";
import type { Change, ChangedFile } from "./changeDetails";
import { grammarOfPath, type GrammarName } from "./formattingGrammars";
import type {
  FormattingAnswer,
  FormattingJob,
  FormattingWorkerData,
} from "./formattingWorker";
import { gitOutput } from "./git";

export type FormattingReason = "formatting" | "movedFormatting";

export const formattingLimits = {
  /** The most a version of a file may be, in bytes. */
  maxBytes: 1024 * 1024,
  /** The time for both parses of a file, and the comparison. */
  fileMs: 500,
  /** The time for a Change's files, from when the first is looked at. */
  changeMs: 15_000,
  /** How long after a failure to list a Change's changes it is asked again. */
  retryMs: 5000,
};

/** Added to a file's time before the worker is given up on, for loading a grammar. */
const defaultGraceMs = 10_000;

/** Failures of the worker in a row before it is left alone for a while. */
const maxFailures = 3;

/** How long the worker is left alone after that, before it is tried again. */
const defaultCoolOffMs = 60_000;

/** One file to compare: modified in place, or moved with edits, as git pairs it. */
export interface FormattingCandidate {
  basePath: string;
  baseBlob: string;
  headPath: string;
  headBlob: string;
  moved: boolean;
}

/**
 * How alike two files must be for the diff to propose them as a move.
 * Reformatting changes most lines, so the usual 50% would miss many, and a low
 * bar is safe: the diff only proposes the pair, and the comparison of the two
 * versions decides.
 */
const formattingRenames = "-M20%";

/** Ordinary files, not symbolic links or submodules. */
const regularMode = /^100(644|755)$/;

/**
 * The files to compare, from `git diff --raw --no-abbrev -z` with renames: each
 * modified file, and each file git pairs with a deleted one as a rename.
 * A change of mode, or of blob alone, is no formatting change, and neither is
 * a file that is not an ordinary file on both sides.
 */
export function candidatesIn(raw: string): FormattingCandidate[] {
  const candidates: FormattingCandidate[] = [];
  const fields = raw.split("\0");
  for (let i = 0; i < fields.length;) {
    const header =
      /^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])\d*$/.exec(fields[i]) ??
      undefined;
    if (!header) {
      i += 1;
      continue;
    }
    const [, baseMode, headMode, baseBlob, headBlob, status] = header;
    const paired = status === "R" || status === "C";
    const basePath = fields[i + 1];
    const headPath = paired ? fields[i + 2] : basePath;
    i += paired ? 3 : 2;
    if (
      (status !== "M" && status !== "R") ||
      baseMode !== headMode ||
      !regularMode.test(headMode) ||
      baseBlob === headBlob ||
      basePath === undefined ||
      headPath === undefined
    )
      continue;
    candidates.push({
      basePath,
      baseBlob,
      headPath,
      headBlob,
      moved: status === "R",
    });
  }
  return candidates;
}

/** How long git has to give two blobs, such as from a repository that fetches what it lacks. */
const readMs = 10_000;

/**
 * The text of two blobs, if neither is over `maxBytes` and both are valid
 * UTF-8. Bytes that aren't would decode to the same replacement character
 * whatever they were, which could hide a change. Gives null for blobs that
 * can't be used, which holds whenever they're asked about, and undefined when
 * git couldn't be asked, took too long or lacks a blob, which may not hold
 * next time.
 */
export function readBlobs(
  repository: string,
  blobs: readonly [string, string],
  maxBytes: number
): Promise<[string, string] | null | undefined> {
  return new Promise((resolve) => {
    const child = spawn("git", ["cat-file", "--batch"], {
      cwd: repository,
      stdio: ["pipe", "pipe", "ignore"],
    });
    const chunks: Buffer[] = [];
    let total = 0;
    // The headers and the two blobs, so a larger one stops being read.
    const cap = 2 * maxBytes + 1024;
    let settled = false;
    const finish = (texts: [string, string] | null | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(texts);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(undefined);
    }, readMs);
    child.stdout.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > cap) {
        child.kill();
        finish(null);
      } else chunks.push(chunk);
    });
    child.on("error", () => finish(undefined));
    child.on("close", (code) =>
      finish(
        code === 0
          ? textsIn(Buffer.concat(chunks), maxBytes, blobs.length)
          : undefined
      )
    );
    child.stdin.on("error", () => undefined);
    child.stdin.end(blobs.map((blob) => `${blob}\n`).join(""));
  });
}

function textsIn(
  output: Buffer,
  maxBytes: number,
  count: number
): [string, string] | null | undefined {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const texts: string[] = [];
  let at = 0;
  try {
    for (let n = 0; n < count; n++) {
      const end = output.indexOf("\n", at);
      if (end < 0) return null;
      const line = output.toString("utf8", at, end);
      // An object the repository lacks may be there later, such as in a
      // partial clone, so it is for this time only.
      if (/^[0-9a-f]+ missing$/.test(line)) return undefined;
      const header = /^[0-9a-f]+ blob (\d+)$/.exec(line);
      if (!header) return null;
      const size = Number(header[1]);
      if (size > maxBytes || end + 1 + size > output.length) return null;
      texts.push(decoder.decode(output.subarray(end + 1, end + 1 + size)));
      at = end + 1 + size + 1;
    }
  } catch {
    return null;
  }
  return texts.length === 2 ? [texts[0], texts[1]] : null;
}

/** Whether two versions differ in formatting only, or undefined if no answer came. */
export type CompareFormatting = (
  job: Omit<FormattingJob, "id">
) => Promise<boolean | undefined>;

/**
 * The worker thread that compares versions, started on the first job and
 * again after it fails. One job runs at a time. A job that outlasts its time
 * by the grace period ends the worker, and so does a crash. A worker that fails
 * `maxFailures` times in a row is left alone for a minute, and then tried
 * again, so a bad spell doesn't end the marks for the rest of the session.
 */
export class FormattingWorker {
  private worker?: Worker;
  private waiting = new Map<number, (answer: boolean | undefined) => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private lastId = 0;
  private failures = 0;
  private leftAloneAt?: number;
  private disposed = false;

  constructor(
    private readonly options: {
      /** The bundled `formattingWorker.js`. */
      file: string;
      /** The folder of the runtime's `.wasm` and each grammar's. */
      wasmDir: string;
      /** How long past a job's time the worker has, for loading what it needs. */
      graceMs?: number;
      /** How long the worker is left alone after it fails again and again. */
      coolOffMs?: number;
    }
  ) {}

  readonly compare: CompareFormatting = (job) => {
    const answer = this.queue.then(() => this.run(job));
    this.queue = answer.catch(() => undefined);
    return answer;
  };

  dispose(): void {
    this.disposed = true;
    void this.worker?.terminate();
  }

  private run(job: Omit<FormattingJob, "id">): Promise<boolean | undefined> {
    if (this.disposed) return Promise.resolve(undefined);
    if (this.failures >= maxFailures) {
      const coolOffMs = this.options.coolOffMs ?? defaultCoolOffMs;
      if (Date.now() - (this.leftAloneAt ?? 0) < coolOffMs)
        return Promise.resolve(undefined);
      // One more failure leaves it alone again.
      this.failures = maxFailures - 1;
    }
    let worker: Worker;
    try {
      worker = this.start();
    } catch {
      this.fail();
      return Promise.resolve(undefined);
    }
    const id = ++this.lastId;
    return new Promise((resolve) => {
      const timer = setTimeout(
        () => void worker.terminate(),
        job.budgetMs + (this.options.graceMs ?? defaultGraceMs)
      );
      this.waiting.set(id, (answer) => {
        clearTimeout(timer);
        resolve(answer);
      });
      try {
        worker.postMessage({ ...job, id } satisfies FormattingJob);
      } catch {
        void worker.terminate();
      }
    });
  }

  private start(): Worker {
    if (this.worker) return this.worker;
    const data: FormattingWorkerData = { wasmDir: this.options.wasmDir };
    const worker = new Worker(this.options.file, { workerData: data });
    // A worker waiting for a job doesn't keep the process alive.
    worker.unref();
    worker.on("message", (answer: FormattingAnswer) => {
      this.failures = 0;
      this.waiting.get(answer.id)?.(answer.formattingOnly ?? undefined);
      this.waiting.delete(answer.id);
    });
    const gone = () => {
      if (this.worker !== worker) return;
      this.worker = undefined;
      this.fail();
      for (const answer of this.waiting.values()) answer(undefined);
      this.waiting.clear();
    };
    worker.on("error", gone);
    worker.on("exit", gone);
    this.worker = worker;
    return worker;
  }

  private fail(): void {
    this.failures += 1;
    if (this.failures >= maxFailures) this.leftAloneAt = Date.now();
  }
}

interface Analysis {
  marks: Map<string, FormattingReason>;
  done: Promise<void>;
  /** When the changes of the Change couldn't be listed, so it is asked again after a while. */
  failedAt?: number;
}

/** How long marks that arrive close together wait, to tell the views once. */
const notifyMs = 100;

/**
 * The formatting-only marks of the Changes looked at, kept until the window
 * closes. A Change's marks are for its base and head, so a new head starts
 * afresh, but results are kept for each pair of blobs and shared.
 */
export class FormattingMarks {
  private readonly analyses = new Map<string, Analysis>();
  private readonly verdicts = new Map<string, boolean>();
  private notifyTimer?: NodeJS.Timeout;
  private disposed = false;

  constructor(
    private readonly options: {
      compare: CompareFormatting;
      /** Called when marks have been added, for the views to show them. */
      changed: () => void;
    }
  ) {}

  /** The marks found so far for the Change, which grow until it is done. */
  ready(change: Change): ReadonlyMap<string, FormattingReason> {
    return this.analyses.get(keyOf(change))?.marks ?? new Map();
  }

  /**
   * Starts finding the Change's marks, unless it has. `skip` are files with a
   * reason already. Settles once the Change's files have been looked at, or
   * its time has run out. Never rejects.
   */
  start(
    change: Change,
    files: readonly ChangedFile[],
    skip: ReadonlySet<string>
  ): Promise<void> {
    const key = keyOf(change);
    let analysis = this.analyses.get(key);
    if (
      !analysis ||
      (analysis.failedAt !== undefined &&
        Date.now() - analysis.failedAt >= formattingLimits.retryMs)
    ) {
      const marks = new Map<string, FormattingReason>();
      const fresh: Analysis = { marks, done: Promise.resolve() };
      fresh.done = this.find(
        change,
        new Set(files.map((f) => f.path)),
        skip,
        marks
      ).then(
        (listed) => {
          if (!listed) fresh.failedAt = Date.now();
        },
        () => {
          fresh.failedAt = Date.now();
        }
      );
      analysis = fresh;
      this.analyses.set(key, analysis);
    }
    return analysis.done;
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.notifyTimer);
  }

  private async find(
    change: Change,
    paths: ReadonlySet<string>,
    skip: ReadonlySet<string>,
    marks: Map<string, FormattingReason>
  ): Promise<boolean> {
    const started = Date.now();
    const raw = await gitOutput(
      change.repository,
      "diff",
      "--raw",
      formattingRenames,
      "--no-abbrev",
      "-z",
      change.mergeBase,
      change.headSha
    );
    for (const candidate of candidatesIn(raw)) {
      if (this.disposed || Date.now() - started >= formattingLimits.changeMs)
        return true;
      const { basePath, headPath } = candidate;
      if (
        !paths.has(basePath) ||
        !paths.has(headPath) ||
        skip.has(basePath) ||
        skip.has(headPath)
      )
        continue;
      const grammar = grammarOfPath(headPath);
      if (!grammar || grammarOfPath(basePath) !== grammar) continue;
      if (!(await this.formattingOnly(change.repository, grammar, candidate)))
        continue;
      if (candidate.moved) {
        marks.set(basePath, "movedFormatting");
        marks.set(headPath, "movedFormatting");
      } else marks.set(headPath, "formatting");
      this.notifyLater();
    }
    return true;
  }

  private async formattingOnly(
    repository: string,
    grammar: GrammarName,
    { baseBlob, headBlob }: FormattingCandidate
  ): Promise<boolean> {
    const key = [grammar, baseBlob, headBlob].join("\0");
    const known = this.verdicts.get(key);
    if (known !== undefined) return known;
    const texts = await readBlobs(
      repository,
      [baseBlob, headBlob],
      formattingLimits.maxBytes
    );
    // A version too large, or not UTF-8, is that way for every Change with it.
    // Not being able to read one is for this time only.
    if (texts === null) this.verdicts.set(key, false);
    if (!texts) return false;
    const answer = await this.options.compare({
      grammar,
      base: texts[0],
      head: texts[1],
      budgetMs: formattingLimits.fileMs,
    });
    // No answer is for this time only, such as a worker that crashed.
    if (answer !== undefined) this.verdicts.set(key, answer);
    return answer === true;
  }

  private notifyLater(): void {
    if (this.notifyTimer || this.disposed) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = undefined;
      this.options.changed();
    }, notifyMs);
  }
}

const keyOf = (change: Change) =>
  [change.repository, change.mergeBase, change.headSha].join("\0");
