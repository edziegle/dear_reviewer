// Entry point VSCodium calls inside the extension host. Runs the Mocha files
// for the suite named in DEAR_REVIEWER_SUITE.

import * as fs from "fs";
import * as path from "path";
import Mocha from "mocha";
import { isReviewWindow, observeReviewWindow } from "./reviewWindowProbe";

export function run(): Promise<void> {
  if (isReviewWindow()) return observeReviewWindow();
  const suite = process.env.DEAR_REVIEWER_SUITE ?? "multiRoot";
  const mocha = new Mocha({ ui: "bdd", timeout: 120_000, color: true });
  const folder = path.join(__dirname, suite);
  for (const file of fs.readdirSync(folder).sort()) {
    if (file.endsWith(".test.js")) mocha.addFile(path.join(folder, file));
  }
  return new Promise((resolve, reject) => {
    mocha.run((failures) =>
      failures ? reject(new Error(`${failures} tests failed`)) : resolve()
    );
  });
}
