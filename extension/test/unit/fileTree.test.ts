import * as assert from "assert";
import { fileTree, type FileTreeNode } from "../../src/fileTree";

const files = [
  "infra/modules/vpc/main.tofu",
  "infra/modules/vpc/variables.tofu",
  "pkg/core.py",
  "pkg/sub/new.py",
  "README.md",
].map((path) => ({ path }));

/** Each row as its name, with a folder's rows under it. */
function rows(nodes: FileTreeNode<{ path: string }>[]): unknown[] {
  return nodes.map((node) =>
    node.kind === "file"
      ? node.file.path.split("/").pop()
      : { [node.name]: rows(node.children) }
  );
}

describe("Change Files' folders and files", () => {
  it("lists folders first, then files, each by name", () => {
    assert.deepStrictEqual(rows(fileTree(files, { compact: false })), [
      {
        infra: [
          { modules: [{ vpc: ["main.tofu", "variables.tofu"] }] },
        ],
      },
      { pkg: [{ sub: ["new.py"] }, "core.py"] },
      "README.md",
    ]);
  });

  it("joins a folder whose only child is a folder into one row, as the Explorer compacts them", () => {
    assert.deepStrictEqual(rows(fileTree(files, { compact: true })), [
      { "infra/modules/vpc": ["main.tofu", "variables.tofu"] },
      { pkg: [{ sub: ["new.py"] }, "core.py"] },
      "README.md",
    ]);
  });

  it("keeps a compacted folder's whole path and every file under it", () => {
    const [infra] = fileTree(files, { compact: true });
    assert.ok(infra.kind === "directory");
    assert.strictEqual(infra.path, "infra/modules/vpc");
    assert.deepStrictEqual(
      infra.files.map((f) => f.path),
      ["infra/modules/vpc/main.tofu", "infra/modules/vpc/variables.tofu"]
    );
  });

  it("leaves out the files not shown, and folders left empty", () => {
    const shown = (f: { path: string }) => !f.path.startsWith("pkg/sub/");
    assert.deepStrictEqual(rows(fileTree(files, { compact: true, shown })), [
      { "infra/modules/vpc": ["main.tofu", "variables.tofu"] },
      { pkg: ["core.py"] },
      "README.md",
    ]);
  });
});
