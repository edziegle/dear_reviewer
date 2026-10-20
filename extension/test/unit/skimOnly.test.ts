// Which changed files are skim-only (ADR 0045), against a real repository
// under plain Node for the part that asks git.

import * as assert from "assert";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { Change, ChangedFile } from "../../src/changeDetails";
import {
  exactRenamesIn,
  isLockFile,
  skimOnlyFiles,
  skimOnlyOf,
} from "../../src/skimOnly";

const modified = (p: string): ChangedFile => ({ path: p, status: "modified" });

describe("Lock files", () => {
  it("are found by name in any folder", () => {
    for (const name of [
      "package-lock.json",
      "npm-shrinkwrap.json",
      "yarn.lock",
      "pnpm-lock.yaml",
      "bun.lockb",
      "Cargo.lock",
      "uv.lock",
      "poetry.lock",
      "Pipfile.lock",
      "Gemfile.lock",
      "go.sum",
      "composer.lock",
      "Podfile.lock",
      "pubspec.lock",
      "mix.lock",
      "flake.lock",
    ]) {
      assert.ok(isLockFile(name), name);
      assert.ok(isLockFile(`apps/web/${name}`), `apps/web/${name}`);
    }
  });

  it("are not files of a similar name", () => {
    for (const name of [
      "package.json",
      "yarn.lock.bak",
      "my-package-lock.json",
      "package-lock.json.orig",
      "cargo.lock",
      "lock",
      "docs/package-lock.json/readme.md",
    ])
      assert.ok(!isLockFile(name), name);
  });
});

describe("Skim-only files", () => {
  it("give each file its reason, a lock file first", () => {
    const skim = skimOnlyFiles({
      files: [
        modified("src/app.ts"),
        modified("yarn.lock"),
        modified("gen/api.ts"),
        modified("old/name.ts"),
        modified("new/name.ts"),
        modified("go.sum"),
      ],
      generated: new Set(["gen/api.ts", "go.sum"]),
      renamed: new Set(["old/name.ts", "new/name.ts", "yarn.lock"]),
    });
    assert.deepStrictEqual(
      [...skim],
      [
        ["yarn.lock", "lockFile"],
        ["gen/api.ts", "generated"],
        ["old/name.ts", "renamed"],
        ["new/name.ts", "renamed"],
        ["go.sum", "lockFile"],
      ]
    );
  });

  it("leave out a generated or renamed path that the Change doesn't change", () => {
    const skim = skimOnlyFiles({
      files: [modified("a.ts")],
      generated: new Set(["elsewhere.ts"]),
      renamed: new Set(["other.ts"]),
    });
    assert.deepStrictEqual([...skim], []);
  });
});

describe("Exact renames", () => {
  const record = (status: string, before: string, after: string, p: string) =>
    `:100644 100644 ${before} ${after} ${status}\0${p}\0`;
  const zero = "0".repeat(40);
  const blob = (n: number) => String(n).repeat(40);

  it("pair an added file with a deleted one of the same blob", () => {
    const raw = [
      record("D", blob(1), zero, "old/a.ts"),
      record("A", zero, blob(1), "new/a.ts"),
      record("M", blob(2), blob(3), "edited.ts"),
      record("D", blob(4), zero, "moved/with-edit.ts"),
      record("A", zero, blob(5), "moved/with-edit-2.ts"),
    ].join("");
    assert.deepStrictEqual([...exactRenamesIn(raw)].sort(), [
      "new/a.ts",
      "old/a.ts",
    ]);
  });

  it("do not count a file that is only added or only deleted", () => {
    assert.deepStrictEqual(
      [
        ...exactRenamesIn(
          record("A", zero, blob(1), "a.ts") +
            record("D", blob(2), zero, "b.ts")
        ),
      ],
      []
    );
  });

  it("take a copy of a deleted file as a rename of it", () => {
    const raw =
      record("D", blob(1), zero, "old.ts") +
      record("A", zero, blob(1), "one.ts") +
      record("A", zero, blob(1), "two.ts");
    assert.deepStrictEqual([...exactRenamesIn(raw)].sort(), [
      "old.ts",
      "one.ts",
      "two.ts",
    ]);
  });

  it("read nothing from output that isn't a record", () => {
    assert.deepStrictEqual([...exactRenamesIn("")], []);
    assert.deepStrictEqual([...exactRenamesIn("garbage\0text\0")], []);
  });
});

describe("Skim-only files of a real Change", () => {
  const dir = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "dr-skim-only-")
  );
  const git = (...args: string[]) =>
    cp.execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  };
  const commit = (message: string) => {
    git("add", "-A");
    git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "reviewer@example.com");
  git("config", "user.name", "Reviewer");
  git("config", "commit.gpgsign", "false");

  write(".gitattributes", "gen/** linguist-generated\n");
  write("sub/.gitattributes", "*.pb.go linguist-generated=true\n");
  write("gen/api.ts", "api 1\n");
  write("sub/model.pb.go", "model 1\n");
  write("src/app.ts", "app 1\n");
  write("old/moved.ts", "same bytes\n");
  write("old/moved-edited.ts", "before\n");
  write("package-lock.json", "{}\n");
  const base = commit("base");

  // The head tries to hide its own files and to un-mark the generated ones.
  write(
    ".gitattributes",
    "* -linguist-generated\nsrc/app.ts linguist-generated\nown/** linguist-generated\n"
  );
  write("gen/api.ts", "api 2\n");
  write("sub/model.pb.go", "model 2\n");
  write("src/app.ts", "app 2\n");
  write("own/generated-by-the-pull-request.ts", "own\n");
  fs.rmSync(path.join(dir, "old/moved.ts"));
  write("new/moved.ts", "same bytes\n");
  fs.rmSync(path.join(dir, "old/moved-edited.ts"));
  write("new/moved-edited.ts", "after\n");
  write("package-lock.json", '{"changed": true}\n');
  const head = commit("head");

  const change = {
    repository: dir,
    mergeBase: base,
    headSha: head,
  } as unknown as Change;

  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("goes by the base's .gitattributes, not the head's, and by blobs for a rename", async () => {
    const files = git("diff", "--name-only", "--no-renames", base, head)
      .split("\n")
      .map(modified);

    const skim = await skimOnlyOf(change, files);

    assert.deepStrictEqual(Object.fromEntries(skim), {
      "gen/api.ts": "generated",
      "sub/model.pb.go": "generated",
      "old/moved.ts": "renamed",
      "new/moved.ts": "renamed",
      "package-lock.json": "lockFile",
    });
  });

  it("marks nothing when git can't answer", async () => {
    const lost = {
      repository: path.join(dir, "missing"),
      mergeBase: base,
      headSha: head,
    } as unknown as Change;
    assert.deepStrictEqual(
      [...(await skimOnlyOf(lost, [modified("gen/api.ts")]))],
      []
    );
  });
});
