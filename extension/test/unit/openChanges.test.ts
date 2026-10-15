import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { changeInFront, OpenChange, OpenChanges } from "../../src/openChanges";

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

  it("leaves the others in their order when a Change behind the front closes", () => {
    for (const id of ["abc", "def", "xyz"]) open.put(changeNamed(id));
    open.remove("def");
    assert.deepStrictEqual(ids(open.all()), ["abc", "xyz"]);
  });
});
