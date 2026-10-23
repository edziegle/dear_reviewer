// What Dear Reviewer finds of a Change's repetition (ADR 0047), from a real
// repository under plain Node: the Change's hunks, the repository index and
// what the overview and the Findings prompt are given.

import * as assert from "assert";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { Change } from "../../src/changeDetails";
import {
  headingOf,
  headlineOf,
  hunksIn,
  Repetitions,
  showMoreOf,
  type ShownRepeatedEdit,
} from "../../src/repetitions";

describe("Hunks of a diff", () => {
  it("are read from a diff of no context, with their lines and where they start", () => {
    const diff = [
      "diff --git a/src/app.py b/src/app.py",
      "index 1111111..2222222 100644",
      "--- a/src/app.py",
      "+++ b/src/app.py",
      "@@ -3 +3 @@ def run():",
      "-    legacy(1)",
      "+    modern(1)",
      "@@ -10,2 +10,0 @@",
      "-gone(1)",
      "-gone(2)",
      "@@ -20,0 +19,2 @@",
      "+new(1)",
      "+new(2)",
      "\\ No newline at end of file",
      "",
    ].join("\n");
    assert.deepStrictEqual(hunksIn(diff), [
      {
        path: "src/app.py",
        status: "modified",
        oldStart: 3,
        removed: ["    legacy(1)"],
        newStart: 3,
        added: ["    modern(1)"],
      },
      {
        path: "src/app.py",
        status: "modified",
        oldStart: 10,
        removed: ["gone(1)", "gone(2)"],
        newStart: 10,
        added: [],
      },
      {
        path: "src/app.py",
        status: "modified",
        oldStart: 20,
        removed: [],
        newStart: 19,
        added: ["new(1)", "new(2)"],
      },
    ]);
  });

  it("tell an added file from a deleted one by the side that is /dev/null", () => {
    const diff = [
      "diff --git a/new.py b/new.py",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/new.py",
      "@@ -0,0 +1,2 @@",
      "+a",
      "+b",
      "diff --git a/old.py b/old.py",
      "deleted file mode 100644",
      "--- a/old.py",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-c",
    ].join("\n");
    assert.deepStrictEqual(
      hunksIn(diff).map((h) => [h.path, h.status]),
      [
        ["new.py", "added"],
        ["old.py", "deleted"],
      ]
    );
  });

  it("read a removed line that looks like a header as a line", () => {
    const diff = [
      "diff --git a/q.sql b/q.sql",
      "--- a/q.sql",
      "+++ b/q.sql",
      "@@ -1 +1 @@",
      "--- a comment",
      "+++ another",
    ].join("\n");
    const [hunk] = hunksIn(diff);
    assert.deepStrictEqual(hunk.removed, ["-- a comment"]);
    assert.deepStrictEqual(hunk.added, ["++ another"]);
  });

  it("read the names git quotes or ends with a tab, and leave out binary files", () => {
    const diff = [
      'diff --git "a/tab\\there.py" "b/tab\\there.py"',
      '--- "a/tab\\there.py"',
      '+++ "b/tab\\there.py"',
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "diff --git a/with space.py b/with space.py",
      "--- a/with space.py\t",
      "+++ b/with space.py\t",
      "@@ -1 +1 @@",
      "-c",
      "+d",
      "diff --git a/image.png b/image.png",
      "Binary files a/image.png and b/image.png differ",
    ].join("\n");
    assert.deepStrictEqual(
      hunksIn(diff).map((h) => h.path),
      ["tab\there.py", "with space.py"]
    );
  });

  it("drop the carriage return of a line ending", () => {
    const diff = [
      "diff --git a/x.txt b/x.txt",
      "--- a/x.txt",
      "+++ b/x.txt",
      "@@ -1 +1 @@",
      "-old\r",
      "+new\r",
    ].join("\n");
    assert.deepStrictEqual(hunksIn(diff)[0].removed, ["old"]);
  });
});

describe("What the overview says of a Repeated edit", () => {
  const at = (path: string, line: number) => ({
    path,
    side: "head" as const,
    line,
    endLine: line,
  });

  it("heads an edit with its places and files, singular for one file", () => {
    assert.strictEqual(
      headlineOf([at("a.ts", 1), at("a.ts", 9), at("a.ts", 20)], false),
      "Same edit in 3 places in 1 file"
    );
    assert.strictEqual(
      headlineOf([at("a.ts", 1), at("a.ts", 9), at("b.ts", 2)], false),
      "Same edit in 3 places in 2 files"
    );
    assert.strictEqual(
      headlineOf([at("a.ts", 1), at("b.ts", 1), at("c.ts", 1)], false),
      "Same edit in 3 files"
    );
  });

  it("says what a uniform edit lets the Reviewer do", () => {
    const sites = Array.from({ length: 40 }, (_, i) => at(`f${i}.ts`, 1));
    assert.strictEqual(
      headlineOf(sites, true),
      "Same edit in 40 files: read one, skim the rest."
    );
  });

  it("shows five sites of a list, and offers the rest of those listed", () => {
    assert.strictEqual(showMoreOf(5), undefined, "five show whole");
    assert.strictEqual(showMoreOf(7), "Show all 7");
    assert.strictEqual(showMoreOf(20, 480), "Show 15 more");
    assert.strictEqual(showMoreOf(3, 0), undefined);
  });

  it("counts the edits to check, or all the edits when every one is uniform", () => {
    const edit = (differing: number, missed: number): ShownRepeatedEdit => ({
      summary: "",
      removed: [],
      added: [],
      differing: Array.from({ length: differing }, (_, i) => at("d.ts", i)),
      missed: Array.from({ length: missed }, (_, i) => at("m.ts", i)),
      moreMissed: 0,
    });
    assert.strictEqual(
      headingOf([edit(2, 0), edit(0, 0), edit(0, 1)], "complete"),
      "Repeated edits: 2 to check"
    );
    assert.strictEqual(
      headingOf([edit(0, 0), edit(0, 0)], "complete"),
      "Repeated edits (2)"
    );
  });

  it("doesn't call the edits uniform until the repository is fully checked", () => {
    const uniform: ShownRepeatedEdit = {
      summary: "",
      removed: [],
      added: [],
      differing: [],
      missed: [],
      moreMissed: 0,
    };
    assert.strictEqual(
      headingOf([uniform, uniform], "pending"),
      "Repeated edits (2): still checking"
    );
    assert.strictEqual(
      headingOf([uniform], "partial"),
      "Repeated edits (1): not fully checked"
    );
  });
});

describe("The repetition of a real Change", () => {
  const dir = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "dr-repetitions-")
  );
  const git = (...args: string[]) =>
    cp.execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  const write = (file: string, text: string | Buffer) => {
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

  /** A function of statements of different shapes, which normalizing keeps apart. */
  const shaped = (name: string, count: number, offset = 0) =>
    Array.from({ length: count }, (_, i) => {
      const depth = i + 1 + offset;
      return `  ${name}(${"[".repeat(depth)}${i}${"]".repeat(depth)});`;
    }).join("\n");

  // The base has four callers of legacy(), and an original block.
  for (const site of "abcd")
    write(`src/${site}.js`, `import x from "x";\nlegacy(${site});\n`);
  write("src/unswept.js", "// not swept\nlegacy(unswept);\n");
  write("src/unswept_other.js", "other(unswept);\n");
  write("lib/original.js", `function original() {\n${shaped("run", 8)}\n}\n`);
  write("package-lock.json", '{"legacy": "legacy(lock)"}\n');
  write("gen/api.js", "legacy(generated);\n");
  write(".gitattributes", "gen/** linguist-generated\n");
  write("big.js", `legacy(big);\n${"x".repeat(3000)}\n`);
  write("blob.bin", Buffer.from("legacy(blob)\0\0\0"));
  // Three callers of old2(), which one commit sweeps with no site left out.
  for (const n of "123")
    write(`u/${n}.js`, `import q from "q";\nold2(${n});\n`);
  const base = commit("base");
  for (const n of "123")
    write(`u/${n}.js`, `import q from "q";\nnew2(${n});\n`);
  const mid = commit("uniform sweep");

  // The head sweeps legacy() to modern() in three of the four, varies the
  // fourth, and adds a copy of the original block, with other names.
  for (const site of "abc")
    write(`src/${site}.js`, `import x from "x";\nmodern(${site});\n`);
  write("src/d.js", 'import x from "x";\nmodern(d, true);\n');
  write("package-lock.json", '{"legacy": "legacy(lock)", "added": 1}\n');
  write(
    "src/copy.js",
    `const keep = 1;\nfunction copied() {\n${shaped("walk", 8)}\n}\n`
  );
  const head = commit("head");

  const change = {
    id: "change",
    repository: dir,
    mergeBase: mid,
    headSha: head,
    baseDir: dir,
    headDir: dir,
    conversation: "repetitions",
  } as Change;
  /** The commit that sweeps old2() alone. */
  const uniform = { ...change, mergeBase: base, headSha: mid } as Change;

  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("finds the sweep of the Change, its differing site and its missed sites, once the index is ready", async () => {
    const repetitions = new Repetitions({ maxFileBytes: 2000 });
    const settled = new Promise<void>((resolve) =>
      repetitions.onDidSettle(resolve)
    );

    const early = await repetitions.repeatedEdits(change);
    assert.strictEqual(early?.checked, "pending");
    assert.strictEqual(early?.edits.length, 1);
    assert.strictEqual(early?.edits[0].summary, "Same edit in 4 files");
    assert.strictEqual(early?.heading, "Repeated edits: 1 to check");
    assert.deepStrictEqual(early?.edits[0].missed, []);

    await settled;
    const shown = await repetitions.repeatedEdits(change);
    assert.strictEqual(shown?.checked, "complete");
    assert.strictEqual(shown?.open, true);
    const [edit] = shown!.edits;
    assert.deepStrictEqual(edit.differing, [
      { path: "src/d.js", side: "head", line: 2, endLine: 2 },
    ]);
    // The files the head left unswept; not the lock file, the generated file,
    // the file over the size cap or the binary file, which the index leaves out.
    assert.deepStrictEqual(
      edit.missed.map((m) => m.path),
      ["src/unswept.js"]
    );
    assert.deepStrictEqual(edit.missed[0], {
      path: "src/unswept.js",
      side: "head",
      line: 2,
      endLine: 2,
    });
    assert.deepStrictEqual(edit.removed, ["legacy(a);"]);
    assert.deepStrictEqual(edit.added, ["modern(a);"]);
  });

  it("is collapsed while every edit is uniform and none was missed", async () => {
    const repetitions = new Repetitions();
    const settled = new Promise<void>((resolve) =>
      repetitions.onDidSettle(resolve)
    );
    await repetitions.repeatedEdits(uniform);
    await settled;
    const shown = await repetitions.repeatedEdits(uniform);
    assert.strictEqual(shown?.checked, "complete");
    assert.strictEqual(shown?.open, false);
    assert.strictEqual(shown?.edits.length, 1);
    assert.strictEqual(
      shown?.edits[0].summary,
      "Same edit in 3 files: read one, skim the rest."
    );
    assert.strictEqual(shown?.heading, "Repeated edits (1)");
    assert.deepStrictEqual(shown?.edits[0].differing, []);
    assert.deepStrictEqual(shown?.edits[0].missed, []);
  });

  it("doesn't tell the Reviewer to skim a uniform edit while missed sites weren't fully checked", async () => {
    const repetitions = new Repetitions({ budgetMs: 0 });
    const settled = new Promise<void>((resolve) =>
      repetitions.onDidSettle(resolve)
    );
    const early = await repetitions.repeatedEdits(uniform);
    assert.strictEqual(early?.checked, "pending");
    assert.strictEqual(early?.edits[0].summary, "Same edit in 3 files");
    assert.strictEqual(early?.heading, "Repeated edits (1): still checking");
    await settled;
    const shown = await repetitions.repeatedEdits(uniform);
    assert.strictEqual(shown?.checked, "partial");
    assert.strictEqual(shown?.edits[0].summary, "Same edit in 3 files");
    assert.strictEqual(shown?.heading, "Repeated edits (1): not fully checked");
  });

  it("says missed sites weren't fully checked when the index ran out of time", async () => {
    // A tiny budget leaves the index partial, and with no file indexed there are no missed sites.
    const repetitions = new Repetitions({ budgetMs: 0 });
    const settled = new Promise<void>((resolve) =>
      repetitions.onDidSettle(resolve)
    );
    await repetitions.repeatedEdits(change);
    await settled;
    const shown = await repetitions.repeatedEdits(change);
    assert.strictEqual(shown?.checked, "partial");
    assert.deepStrictEqual(shown?.edits[0].missed, []);
    assert.strictEqual(
      shown?.open,
      true,
      "the differing site still opens the section"
    );
  });

  it("gives the candidates of a request for Findings: copied code and the sweep's differing and missed sites", async () => {
    const repetitions = new Repetitions({ maxFileBytes: 2000 });
    const found = await repetitions.candidates(change);
    assert.strictEqual(found.partial, false);
    assert.deepStrictEqual(
      found.duplicates.map((c) => [c.path, c.startLine, c.endLine, c.lines]),
      [["src/copy.js", 2, 11, 10]]
    );
    assert.deepStrictEqual(found.duplicates[0].places, [
      { path: "lib/original.js", line: 1, endLine: 10 },
    ]);
    assert.strictEqual(found.edits.length, 1);
    assert.deepStrictEqual(
      found.edits[0].differing.map((s) => s.path),
      ["src/d.js"]
    );
    assert.deepStrictEqual(
      found.edits[0].missed.map((m) => m.path),
      ["src/unswept.js"]
    );
  });

  it("says the check was partial, and still finds copies within the Change, when the budget is gone", async () => {
    const found = await new Repetitions({ budgetMs: 0 }).candidates(change);
    assert.strictEqual(found.partial, true);
    assert.deepStrictEqual(
      found.duplicates.map((c) => c.path),
      [],
      "the original sat in the repository, which the budget never read"
    );
    assert.strictEqual(found.edits.length, 1);
  });

  it("goes on without waiting for an index that is slower than the wait, saying the check was partial", async () => {
    const found = await new Repetitions({ waitMs: 0 }).candidates(change);
    assert.strictEqual(found.partial, true);
    assert.deepStrictEqual(
      found.duplicates.map((c) => c.path),
      [],
      "the original sat in the repository, which was not read in time"
    );
    assert.strictEqual(found.edits.length, 1, "the Change's own hunks still");
  });

  it("finds nothing in a Change with no repetition, and gives no section", async () => {
    const quiet = {
      ...change,
      mergeBase: head,
      headSha: head,
    } as Change;
    const repetitions = new Repetitions();
    assert.strictEqual(await repetitions.repeatedEdits(quiet), undefined);
    const found = await repetitions.candidates(quiet);
    assert.deepStrictEqual(found.duplicates, []);
    assert.deepStrictEqual(found.edits, []);
  });

  it("offers the missed sites past the first five behind Show all", async () => {
    // Three of ten callers of old3() are swept; seven still hold it.
    for (let n = 0; n < 10; n++)
      write(`many/${n}.js`, `import m from "m";\nold3(${n});\n`);
    const before = commit("ten callers");
    for (let n = 0; n < 3; n++)
      write(`many/${n}.js`, `import m from "m";\nnew3(${n});\n`);
    const after = commit("sweep three");
    const many = { ...change, mergeBase: before, headSha: after } as Change;
    try {
      const repetitions = new Repetitions();
      const settled = new Promise<void>((resolve) =>
        repetitions.onDidSettle(resolve)
      );
      await repetitions.repeatedEdits(many);
      await settled;
      const [edit] = (await repetitions.repeatedEdits(many))!.edits;
      assert.strictEqual(edit.summary, "Same edit in 3 files");
      assert.strictEqual(edit.missed.length, 7);
      assert.strictEqual(edit.moreMissed, 0);
      assert.strictEqual(edit.showMissed, "Show all 7");
      assert.strictEqual(edit.showDiffering, undefined);
    } finally {
      git("reset", "-q", "--hard", head);
    }
  });

  it("gives no section, and no error, when git can't read the Change", async () => {
    const broken = { ...change, repository: path.join(dir, "missing") };
    assert.strictEqual(
      await new Repetitions().repeatedEdits(broken as Change),
      undefined
    );
    const found = await new Repetitions().candidates(broken as Change);
    assert.deepStrictEqual(found.duplicates, []);
    assert.strictEqual(found.partial, true);
  });
});
