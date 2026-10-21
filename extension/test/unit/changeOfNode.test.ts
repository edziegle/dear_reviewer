import * as assert from "assert";
import type { Change } from "../../src/changeDetails";
import type { ChangeFilesNode } from "../../src/changeFiles";
import { changeOfNode } from "../../src/changeOfNode";

const change = { id: "the-change" } as Change;
const file = { path: "a.py", status: "modified" } as const;

describe("The Change a Change Files element stands for", () => {
  it("is the Change itself for a Change row", () => {
    const node: ChangeFilesNode = {
      kind: "change",
      change,
      files: [file],
      viewedCount: 0,
      children: [],
    };
    assert.strictEqual(changeOfNode(node), change);
  });

  it("is the Change a folder is in", () => {
    const node: ChangeFilesNode = {
      kind: "directory",
      change,
      path: "pkg",
      name: "pkg",
      files: [file],
      children: [],
    };
    assert.strictEqual(changeOfNode(node), change);
  });

  it("is the Change a step of the Reading Order is in", () => {
    const node: ChangeFilesNode = {
      kind: "step",
      change,
      index: 0,
      label: "Start here",
      files: [file],
      children: [],
    };
    assert.strictEqual(changeOfNode(node), change);
  });

  it("is the Change a file is in", () => {
    const node: ChangeFilesNode = {
      kind: "file",
      change,
      file,
      viewed: false,
    };
    assert.strictEqual(changeOfNode(node), change);
  });

  it("is none for a problem row, which is in no Change", () => {
    const node: ChangeFilesNode = { kind: "problem", message: "No token." };
    assert.strictEqual(changeOfNode(node), undefined);
  });
});
