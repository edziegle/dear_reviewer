import * as assert from "assert";
import { spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  arrivedDiffs,
  changeInFront,
  OpenChange,
  OpenChanges,
  waitingToShow,
} from "../../src/openChanges";

function changeNamed(id: string, more: Partial<OpenChange> = {}): OpenChange {
  return {
    id,
    repository: "/repo",
    mergeBase: "base",
    headSha: "head",
    baseDir: `/changes/${id}/base`,
    headDir: `/changes/${id}/head`,
    conversation: id,
    inReviewWindow: true,
    ...more,
  };
}

const ids = (changes: readonly OpenChange[]) => changes.map((c) => c.id);

describe("The Change in front", () => {
  const here = () => true;

  it("is the one shown last", () => {
    assert.strictEqual(
      changeInFront([changeNamed("abc"), changeNamed("xyz")], here)?.id,
      "xyz"
    );
  });

  it("is none when no Change is open", () => {
    assert.strictEqual(changeInFront([], here), undefined);
  });

  it("is never one whose folders are in another window", () => {
    const changes = [changeNamed("abc"), changeNamed("xyz")];
    assert.strictEqual(
      changeInFront(changes, (c) => c.id !== "xyz")?.id,
      "abc"
    );
    assert.strictEqual(
      changeInFront(changes, () => false),
      undefined
    );
  });

  it("is never one still waiting for its diff to show", () => {
    assert.strictEqual(
      changeInFront(
        [changeNamed("abc"), changeNamed("xyz", { diffPending: true })],
        here
      )?.id,
      "abc"
    );
  });
});

describe("The open Changes' order", () => {
  let dir: string;
  let open: OpenChanges;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "open-changes-"));
    open = new OpenChanges(dir);
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("runs in the order the Changes were shown", () => {
    open.put(changeNamed("abc"));
    open.put(changeNamed("xyz"));
    assert.deepStrictEqual(ids(open.all()), ["abc", "xyz"]);
    assert.strictEqual(changeInFront(open.all(), () => true)?.id, "xyz");
  });

  it("moves a Change shown again to the front", () => {
    open.put(changeNamed("abc"));
    open.put(changeNamed("xyz"));
    open.put(changeNamed("abc"));
    assert.deepStrictEqual(ids(open.all()), ["xyz", "abc"]);
    assert.strictEqual(changeInFront(open.all(), () => true)?.id, "abc");
  });

  it("brings the Change shown before the one in front to the front when that one closes", () => {
    for (const id of ["abc", "def", "xyz"]) open.put(changeNamed(id));
    open.put(changeNamed("abc"));
    open.remove("abc");
    assert.strictEqual(changeInFront(open.all(), () => true)?.id, "xyz");
    open.remove("xyz");
    assert.strictEqual(changeInFront(open.all(), () => true)?.id, "def");
    open.remove("def");
    assert.strictEqual(
      changeInFront(open.all(), () => true),
      undefined
    );
  });

  it("removes several Changes at once, leaving the others in their order", () => {
    for (const id of ["abc", "def", "ghi", "xyz"]) open.put(changeNamed(id));
    open.removeAll(["xyz", "def"]);
    assert.deepStrictEqual(ids(open.all()), ["abc", "ghi"]);
  });

  it("leaves the others in their order when a Change behind the front closes", () => {
    for (const id of ["abc", "def", "xyz"]) open.put(changeNamed(id));
    open.remove("def");
    assert.deepStrictEqual(ids(open.all()), ["abc", "xyz"]);
  });

  it("keeps a Change where it is when its diff shows, so one opened later stays in front", () => {
    open.put(changeNamed("abc", { diffPending: true }));
    open.put(changeNamed("xyz"));
    open.markShown(["abc"]);
    assert.deepStrictEqual(ids(open.all()), ["abc", "xyz"]);
    assert.strictEqual(open.get("abc")?.diffPending, false);
    assert.strictEqual(changeInFront(open.all(), () => true)?.id, "xyz");
  });
});

describe("Whether the review window has a Change sent to it still to show", () => {
  const pending = changeNamed("abc", { diffPending: true });
  const sent = [pending.baseDir, pending.headDir];

  it("does while a Change waits for its diff and its folders are on their way", () => {
    assert.strictEqual(waitingToShow([pending], ["/home", ...sent]), true);
  });

  it("doesn't once every Change has shown its diff", () => {
    assert.strictEqual(
      waitingToShow([changeNamed("abc")], ["/home", ...sent]),
      false
    );
  });

  it("doesn't for a Change whose folders were never sent, or were taken out", () => {
    assert.strictEqual(waitingToShow([pending], ["/home"]), false);
    assert.strictEqual(
      waitingToShow([pending], ["/home", pending.headDir]),
      false
    );
  });

  it("doesn't for a Change waiting to show in another window", () => {
    assert.strictEqual(
      waitingToShow(
        [changeNamed("abc", { diffPending: true, inReviewWindow: false })],
        ["/home", ...sent]
      ),
      false
    );
  });
});

describe("The diffs that arrive in the review window", () => {
  const arrived = (
    changes: OpenChange[],
    isHere: (change: OpenChange) => boolean = () => true
  ) =>
    arrivedDiffs(changes, isHere).map(({ change, show }) => [change.id, show]);

  it("show in the order their Changes were opened", () => {
    assert.deepStrictEqual(
      arrived([
        changeNamed("abc", { diffPending: true }),
        changeNamed("xyz", { diffPending: true }),
      ]),
      [
        ["abc", true],
        ["xyz", true],
      ]
    );
  });

  it("leave out a Change already shown, and one whose folders haven't arrived", () => {
    assert.deepStrictEqual(
      arrived(
        [
          changeNamed("abc"),
          changeNamed("def", { diffPending: true }),
          changeNamed("xyz", { diffPending: true }),
        ],
        (c) => c.id !== "def"
      ),
      [["xyz", true]]
    );
  });

  it("keep one opened before a Change already shown here behind it, unshown", () => {
    assert.deepStrictEqual(
      arrived([
        changeNamed("abc"),
        changeNamed("def", { diffPending: true }),
        changeNamed("xyz"),
      ]),
      [["def", false]]
    );
  });

  it("show one opened before a Change shown only in another window", () => {
    assert.deepStrictEqual(
      arrived(
        [changeNamed("def", { diffPending: true }), changeNamed("xyz")],
        (c) => c.id !== "xyz"
      ),
      [["def", true]]
    );
  });
});

describe("The open Changes shared by several windows", () => {
  const modulePath = path.join(__dirname, "../../src/openChanges.js");
  let dir: string;
  let open: OpenChanges;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "open-changes-"));
    open = new OpenChanges(dir);
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  /** Runs `body` in its own Node process, as another window's extension host would. */
  function inOtherWindow(body: string): Promise<void> {
    const script = `
      const { OpenChanges } = require(${JSON.stringify(modulePath)});
      const open = new OpenChanges(${JSON.stringify(dir)});
      const change = (id) => (${changeNamed.toString()})(id);
      ${body}`;
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["-e", script], {
        stdio: ["ignore", "inherit", "inherit"],
      });
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`window exited ${code}`))
      );
    });
  }

  it("loses no write when several windows put Changes at once", async function () {
    this.timeout(10_000);
    const windows = Array.from({ length: 6 }, (_, w) =>
      inOtherWindow(
        `for (let i = 0; i < 15; i++) open.put(change("w${w}-" + i));`
      )
    );
    await Promise.all(windows);
    assert.strictEqual(open.all().length, 6 * 15);
  });

  it("loses no write when a window removes Changes while others put theirs", async function () {
    this.timeout(10_000);
    for (let i = 0; i < 20; i++) open.put(changeNamed(`old-${i}`));
    await Promise.all([
      inOtherWindow(
        `for (let i = 0; i < 20; i++) open.removeAll(["old-" + i]);`
      ),
      inOtherWindow(`for (let i = 0; i < 20; i++) open.put(change("a-" + i));`),
      inOtherWindow(`for (let i = 0; i < 20; i++) open.put(change("b-" + i));`),
    ]);
    const kept = ids(open.all());
    assert.strictEqual(kept.length, 40);
    assert.ok(kept.every((id) => !id.startsWith("old-")));
  });

  it("never lets a reader see a partial list while windows write", async function () {
    this.timeout(30_000);
    for (let i = 0; i < 300; i++) open.put(changeNamed(`seed-${i}`));
    let writing = true;
    const writers = Promise.all([
      inOtherWindow(`for (let i = 0; i < 40; i++) open.put(change("a-" + i));`),
      inOtherWindow(`for (let i = 0; i < 40; i++) open.put(change("b-" + i));`),
    ]).finally(() => (writing = false));
    let smallest = Infinity;
    while (writing) {
      smallest = Math.min(smallest, open.all().length);
      await new Promise((resolve) => setImmediate(resolve));
    }
    await writers;
    assert.ok(smallest >= 300, `a read saw only ${smallest} Changes`);
  });

  describe("the lock", () => {
    const lockFile = () => `${open.file}.lock`;

    /** A process that stays alive until the returned function kills it. */
    function liveProcess(): { pid: number; stop: () => void } {
      const child = spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)"]);
      return { pid: child.pid!, stop: () => child.kill() };
    }

    function goneProcessId(): number {
      const result = spawnSync(process.execPath, ["-e", ""]);
      return result.pid;
    }

    it("is taken over when the window that held it is gone", () => {
      fs.writeFileSync(lockFile(), `${goneProcessId()}:token`);
      open.put(changeNamed("abc"));
      assert.deepStrictEqual(ids(open.all()), ["abc"]);
      assert.ok(!fs.existsSync(lockFile()));
    });

    it("is taken over once it is older than the time a write takes", () => {
      const holder = liveProcess();
      try {
        fs.writeFileSync(lockFile(), `${holder.pid}:token`);
        const old = new Date(Date.now() - 60_000);
        fs.utimesSync(lockFile(), old, old);
        new OpenChanges(dir, { staleMs: 1000 }).put(changeNamed("abc"));
        assert.deepStrictEqual(ids(open.all()), ["abc"]);
      } finally {
        holder.stop();
      }
    });

    it("is not stolen from a window that is still alive", () => {
      const holder = liveProcess();
      try {
        fs.writeFileSync(lockFile(), `${holder.pid}:token`);
        const impatient = new OpenChanges(dir, { waitMs: 200 });
        assert.throws(() => impatient.put(changeNamed("abc")), /lock/i);
        assert.strictEqual(
          fs.readFileSync(lockFile(), "utf8"),
          `${holder.pid}:token`
        );
        assert.deepStrictEqual(open.all(), []);
      } finally {
        holder.stop();
      }
    });

    it("is waited on until the other window lets go", async () => {
      const holder = liveProcess();
      try {
        fs.writeFileSync(lockFile(), `${holder.pid}:token`);
        await Promise.all([
          inOtherWindow(
            `setTimeout(() => require("fs").unlinkSync(${JSON.stringify(lockFile())}), 300)`
          ),
          inOtherWindow(`open.put(change("abc"))`),
        ]);
        assert.deepStrictEqual(ids(open.all()), ["abc"]);
      } finally {
        holder.stop();
      }
    });
  });

  it("leaves another window's lock alone when its own was taken over", () => {
    const lockFile = `${open.file}.lock`;
    // Reading the id happens mid-write: another window takes the lock then.
    const slow = changeNamed("abc");
    Object.defineProperty(slow, "id", {
      get() {
        fs.writeFileSync(lockFile, "other-window:token");
        return "abc";
      },
    });
    open.put(slow);
    assert.strictEqual(fs.readFileSync(lockFile, "utf8"), "other-window:token");
  });

  it("does not replace a list that isn't a list with one Change", () => {
    fs.writeFileSync(open.file, "null");
    assert.throws(() => open.put(changeNamed("xyz")), /can't be read/);
    assert.strictEqual(fs.readFileSync(open.file, "utf8"), "null");
  });

  it("does not replace a list it can't parse with one Change", () => {
    fs.writeFileSync(open.file, '[{"id": "abc"');
    assert.deepStrictEqual(open.all(), []);
    assert.throws(() => open.put(changeNamed("xyz")));
    assert.strictEqual(fs.readFileSync(open.file, "utf8"), '[{"id": "abc"');
    assert.ok(!fs.existsSync(`${open.file}.lock`));
  });
});
