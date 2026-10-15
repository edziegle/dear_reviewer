// Entry point VSCodium calls inside the extension host. Runs the Mocha files
// for the suite named in DEAR_REVIEWER_SUITE: only those named in
// DEAR_REVIEWER_TEST_FILES when it's set, and only the tests matching
// DEAR_REVIEWER_GREP when that is.

import * as fs from "fs";
import * as path from "path";
import Mocha from "mocha";
import { isReviewWindow, observeReviewWindow } from "./reviewWindowProbe";

export function run(): Promise<void> {
  if (isReviewWindow()) return observeReviewWindow();
  const suite = process.env.DEAR_REVIEWER_SUITE ?? "multiRoot";
  const only = process.env.DEAR_REVIEWER_TEST_FILES?.split(",");
  const mocha = new Mocha({
    ui: "bdd",
    timeout: 120_000,
    color: true,
    grep: process.env.DEAR_REVIEWER_GREP,
  });
  const folder = path.join(__dirname, suite);
  for (const file of fs.readdirSync(folder).sort()) {
    if (!file.endsWith(".test.js")) continue;
    if (only && !only.includes(file.slice(0, -".test.js".length))) continue;
    mocha.addFile(path.join(folder, file));
  }
  return new Promise((resolve, reject) => {
    const failed: string[] = [];
    mocha
      .run((failures) => {
        // test/backgroundCodium.ts can't see VSCodium's exit code, and
        // test/run.ts lists the failed tests from here.
        const result = process.env.DEAR_REVIEWER_RESULT;
        if (result)
          fs.writeFileSync(
            result,
            failures ? ["failed", ...failed].join("\n") : "passed"
          );
        if (failures) reject(new Error(`${failures} tests failed`));
        else resolve();
      })
      .on("fail", (test) => failed.push(test.fullTitle()));
  });
}
