// Unit tests for the lock that serialises test runs. They need no VSCodium:
// npx tsc -p test && npx mocha out/test/runLock.test.js

import * as assert from "assert";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { acquireRunLock } from "./runLock";

describe("The test run lock", () => {
  let dir: string;
  let lock: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "run-lock-test-"));
    lock = path.join(dir, "test-run.lock");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("waits for the run that holds it to release it", async () => {
    const releaseFirst = await acquireRunLock(lock, "first", () => {}, 10);
    const waitedFor: string[] = [];
    let second = false;
    const acquiring = acquireRunLock(
      lock,
      "second",
      (holder) => waitedFor.push(holder),
      10
    ).then((release) => {
      second = true;
      return release;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.strictEqual(second, false);
    releaseFirst();
    (await acquiring)();
    assert.ok(waitedFor[0]?.includes("first"));
    assert.strictEqual(fs.existsSync(lock), false);
  });

  it("takes over a lock whose run has died", async () => {
    const dead = cp.spawnSync("true").pid;
    fs.writeFileSync(lock, `${dead}\nan interrupted run`);
    const release = await acquireRunLock(lock, "next", () => {}, 10);
    assert.match(fs.readFileSync(lock, "utf8"), /next/);
    release();
  });
});
