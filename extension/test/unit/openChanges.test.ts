import * as assert from "assert";
import { spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  activeChange,
  activeOf,
  arrivedDiffs,
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

describe("The Active Change", () => {
  const here = () => true;

  it("is the one shown last of a list an earlier version left", () => {
    const changes = [changeNamed("abc"), changeNamed("xyz")];
    assert.strictEqual(activeOf(changes)?.id, "xyz");
    assert.strictEqual(activeChange(changes, here)?.id, "xyz");
  });

  it("is none when no Change is open", () => {
    assert.strictEqual(activeOf([]), undefined);
    assert.strictEqual(activeChange([], here), undefined);
  });

  it("is none in a window whose folders are not the Change's", () => {
    assert.strictEqual(
      activeChange([changeNamed("abc")], () => false),
      undefined
    );
  });

  it("is none here while its diff waits to show", () => {
    assert.strictEqual(
      activeChange([changeNamed("abc", { diffPending: true })], here),
      undefined
    );
  });

  it("is the one shown last, not one opened after it that has not shown", () => {
    const changes = [
      changeNamed("abc"),
      changeNamed("xyz", { diffPending: true }),
    ];
    assert.strictEqual(activeOf(changes)?.id, "abc");
  });

  it("is the last listed when none has shown", () => {
    const changes = [
      changeNamed("abc", { diffPending: true }),
      changeNamed("xyz", { diffPending: true }),
    ];
    assert.strictEqual(activeOf(changes)?.id, "xyz");
  });
});

describe("The open Changes' list", () => {
  let dir: string;
  let open: OpenChanges;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "open-changes-"));
    open = new OpenChanges(dir);
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("holds one Change: putting another replaces it", () => {
    open.put(changeNamed("abc"));
    open.put(changeNamed("xyz"));
    assert.deepStrictEqual(ids(open.all()), ["xyz"]);
  });

  it("holds the Change once when it is put again", () => {
    open.put(changeNamed("abc"));
    open.put(changeNamed("abc"));
    assert.deepStrictEqual(ids(open.all()), ["abc"]);
  });

  it("is empty once the Active Change is removed", () => {
    open.put(changeNamed("abc"));
    open.remove("abc");
    assert.deepStrictEqual(open.all(), []);
  });

  it("removes several Changes of a list an earlier version left, leaving the others", () => {
    seed(open, ["abc", "def", "ghi", "xyz"]);
    open.removeAll(["xyz", "def"]);
    assert.deepStrictEqual(ids(open.all()), ["abc", "ghi"]);
  });

  it("keeps the Change where it is when its diff shows", () => {
    open.put(changeNamed("abc", { diffPending: true }));
    open.markShown(["abc"]);
    assert.strictEqual(open.get("abc")?.diffPending, false);
    assert.strictEqual(activeChange(open.all(), () => true)?.id, "abc");
  });
});

/** Writes a list of Changes as an earlier version, which held several, left it. */
function seed(open: OpenChanges, names: string[]): void {
  fs.mkdirSync(path.dirname(open.file), { recursive: true });
  fs.writeFileSync(
    open.file,
    JSON.stringify(names.map((id) => changeNamed(id)))
  );
}

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

describe("The diff that arrives in the review window", () => {
  const arrived = (
    changes: OpenChange[],
    isHere: (change: OpenChange) => boolean = () => true
  ) => arrivedDiffs(changes, isHere).map((change) => change.id);

  it("shows once the Change's folders have arrived", () => {
    assert.deepStrictEqual(
      arrived([changeNamed("abc", { diffPending: true })]),
      ["abc"]
    );
  });

  it("waits for the folders", () => {
    assert.deepStrictEqual(
      arrived([changeNamed("abc", { diffPending: true })], () => false),
      []
    );
  });

  it("is none for a Change already shown", () => {
    assert.deepStrictEqual(arrived([changeNamed("abc")]), []);
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

  it("loses no write when several windows remove Changes at once", async function () {
    this.timeout(10_000);
    seed(
      open,
      Array.from({ length: 6 * 15 }, (_, i) => `c-${i}`)
    );
    const windows = Array.from({ length: 6 }, (_, w) =>
      inOtherWindow(
        `for (let i = 0; i < 15; i++) open.removeAll(["c-" + (${w} * 15 + i)]);`
      )
    );
    await Promise.all(windows);
    assert.deepStrictEqual(open.all(), []);
  });

  it("loses no removal when other windows put Changes", async function () {
    this.timeout(10_000);
    seed(
      open,
      Array.from({ length: 20 }, (_, i) => `old-${i}`)
    );
    await Promise.all([
      inOtherWindow(
        `for (let i = 0; i < 20; i++) open.removeAll(["old-" + i]);`
      ),
      inOtherWindow(`for (let i = 0; i < 20; i++) open.put(change("a-" + i));`),
      inOtherWindow(`for (let i = 0; i < 20; i++) open.put(change("b-" + i));`),
    ]);
    const kept = ids(open.all());
    assert.strictEqual(kept.length, 1);
    assert.ok(/^[ab]-19$/.test(kept[0]), `kept ${kept[0]}`);
  });

  it("never lets a reader see a partial list while windows write", async function () {
    this.timeout(30_000);
    seed(
      open,
      Array.from({ length: 300 }, (_, i) => `seed-${i}`)
    );
    let writing = true;
    const marking = `for (let i = 0; i < 300; i++) open.markShown(["seed-" + i]);`;
    const writers = Promise.all([
      inOtherWindow(marking),
      inOtherWindow(marking),
    ]).finally(() => (writing = false));
    let smallest = Infinity;
    while (writing) {
      smallest = Math.min(smallest, open.all().length);
      await new Promise((resolve) => setImmediate(resolve));
    }
    await writers;
    assert.ok(smallest >= 300, `a read saw only ${smallest} Changes`);
  });

  describe("the ask to close the review window", () => {
    it("goes to one window only, once", () => {
      open.askToCloseWindow();
      assert.strictEqual(new OpenChanges(dir).takeCloseAsk(), true);
      assert.strictEqual(open.takeCloseAsk(), false);
    });

    it("is gone once withdrawn", () => {
      open.askToCloseWindow();
      open.withdrawCloseAsk();
      assert.strictEqual(open.takeCloseAsk(), false);
    });
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
