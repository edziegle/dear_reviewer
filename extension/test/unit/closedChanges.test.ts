import * as assert from "assert";
import { ClosedChanges } from "../../src/closedChanges";

const ids = (...names: string[]) => names.map((id) => ({ id }));

describe("ClosedChanges", () => {
  it("gives the Changes that left the list since the last sync", () => {
    const closed = new ClosedChanges();
    closed.leftSince(ids("a", "b", "c"));
    assert.deepStrictEqual(closed.leftSince(ids("a", "c")), ids("b"));
  });

  it("gives none when nothing left, or the list only grew", () => {
    const closed = new ClosedChanges();
    closed.leftSince(ids("a"));
    assert.deepStrictEqual(closed.leftSince(ids("a")), []);
    assert.deepStrictEqual(closed.leftSince(ids("a", "b")), []);
  });

  it("gives none on the first sync, which has no earlier list to compare with", () => {
    assert.deepStrictEqual(new ClosedChanges().leftSince(ids("a", "b")), []);
  });

  it("gives the old Change when one is replaced by one with a new id", () => {
    const closed = new ClosedChanges();
    closed.leftSince(ids("a", "b"));
    assert.deepStrictEqual(closed.leftSince(ids("a", "b2")), ids("b"));
  });

  it("gives a Change only once", () => {
    const closed = new ClosedChanges();
    closed.leftSince(ids("a", "b"));
    closed.leftSince(ids("a"));
    assert.deepStrictEqual(closed.leftSince(ids("a")), []);
  });

  it("gives the Change as the last sync saw it", () => {
    const closed = new ClosedChanges<{ id: string; head: string }>();
    closed.leftSince([{ id: "a", head: "h1" }]);
    assert.deepStrictEqual(closed.leftSince([]), [{ id: "a", head: "h1" }]);
  });
});
