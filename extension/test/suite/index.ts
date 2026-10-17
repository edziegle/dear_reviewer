// Entry point VSCodium calls inside the extension host. Runs the phases that
// DEAR_REVIEWER_PLAN lists, one after another, each as a Mocha run of its own
// folder's files: only those the plan names for it when it names any, and
// only the tests matching DEAR_REVIEWER_GREP when that is set. A phase that
// fails doesn't stop the ones after it. After each phase the progress goes to
// DEAR_REVIEWER_PROGRESS, so test/run.ts can tell which phase crashed the
// extension host and which never ran.

import * as fs from "fs";
import * as path from "path";
import Mocha from "mocha";
import type { Progress } from "../runPlan";
import { isReviewWindow, observeReviewWindow } from "./reviewWindowProbe";

interface PlannedPhase {
  phase: string;
  files?: string[];
}

/** Runs one phase's files, and gives the full titles of the tests that failed. */
function runPhase({ phase, files }: PlannedPhase): Promise<string[]> {
  // Each suite keeps its fixtures, and what it hands to its later phases, in
  // a folder of its own, set before the files load, since they build repositories as they load.
  process.env.DEAR_REVIEWER_FIXTURES = path.join(
    process.env.DEAR_REVIEWER_FIXTURES_ROOT!,
    phase.split("/")[0]
  );
  const mocha = new Mocha({
    ui: "bdd",
    timeout: 120_000,
    color: true,
    grep: process.env.DEAR_REVIEWER_GREP,
  });
  const folder = path.join(__dirname, phase);
  for (const file of fs.readdirSync(folder).sort()) {
    if (!file.endsWith(".test.js")) continue;
    if (files && !files.includes(file.slice(0, -".test.js".length))) continue;
    mocha.addFile(path.join(folder, file));
  }
  return new Promise((resolve) => {
    const failed: string[] = [];
    mocha
      .run(() => resolve(failed))
      .on("fail", (test) => failed.push(test.fullTitle()));
  });
}

export async function run(): Promise<void> {
  if (isReviewWindow()) return observeReviewWindow();
  const plan: PlannedPhase[] = JSON.parse(process.env.DEAR_REVIEWER_PLAN!);
  const progress: Progress = { done: [] };
  const record = () =>
    fs.writeFileSync(
      process.env.DEAR_REVIEWER_PROGRESS!,
      JSON.stringify(progress)
    );
  for (const planned of plan) {
    progress.running = planned.phase;
    record();
    progress.done.push({
      phase: planned.phase,
      failed: await runPhase(planned),
    });
    delete progress.running;
    record();
  }
  const failures = progress.done.flatMap((d) => d.failed);
  // test/backgroundCodium.ts can't see VSCodium's exit code, so it reads this.
  const result = process.env.DEAR_REVIEWER_RESULT;
  if (result)
    fs.writeFileSync(result, failures.length > 0 ? "failed" : "passed");
  if (failures.length > 0) throw new Error(`${failures.length} tests failed`);
}
