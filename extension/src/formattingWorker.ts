// The worker thread that compares file versions (ADR 0048), so parsing never
// runs on the extension host's main thread. It loads `web-tree-sitter` and
// the grammars from the folder in its `workerData`, which holds the `.wasm`
// files the build copied there, and answers each job in the order it came.
// formattingMarks.ts starts it and gives up on it if it stops answering.

import * as path from "path";
import { parentPort, workerData } from "worker_threads";
import type { GrammarName } from "./formattingGrammars";
import { FormattingComparer } from "./formattingOnly";

export interface FormattingJob {
  id: number;
  grammar: GrammarName;
  base: string;
  head: string;
  /** How long the parses and the comparison may take, from when the grammar has loaded. */
  budgetMs: number;
}

export interface FormattingAnswer {
  id: number;
  /** Null when the worker couldn't tell, such as when the time ran out. */
  formattingOnly: boolean | null;
}

export interface FormattingWorkerData {
  /** The folder of the runtime's `.wasm` and each grammar's. */
  wasmDir: string;
}

if (parentPort) {
  const port = parentPort;
  const { wasmDir } = workerData as FormattingWorkerData;
  const comparer = FormattingComparer.create((name) =>
    path.join(wasmDir, name)
  );
  // Without this a failure to load the runtime would be an unhandled rejection
  // before any job asks; each job's await shows it as a no.
  comparer.catch(() => undefined);
  const answer = async (job: FormattingJob) => {
    let formattingOnly: boolean | null = null;
    try {
      formattingOnly =
        (await (
          await comparer
        ).isFormattingOnly(job.grammar, job.base, job.head, job.budgetMs)) ??
        null;
    } catch {
      // Any failure is no mark.
    }
    const reply: FormattingAnswer = { id: job.id, formattingOnly };
    port.postMessage(reply);
  };
  // One job at a time, so a job's time is not spent on another's.
  let last: Promise<void> = Promise.resolve();
  port.on("message", (job: FormattingJob) => {
    last = last.then(() => answer(job));
  });
}
