import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
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
