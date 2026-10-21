// How formatting-only marks are found (ADR 0048): which files git offers, how
// their versions are read, what the budgets cut off, and how the worker
// thread fails, against real repositories under plain Node. The comparison
// itself is tested in formattingOnly.test.ts.

import * as assert from "assert";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { Change, ChangedFile } from "../../src/changeDetails";
import {
  candidatesIn,
  FormattingMarks,
  FormattingWorker,
  formattingLimits,
  readBlobs,
  type CompareFormatting,
} from "../../src/formattingMarks";
import { copyWasmFiles } from "./treeSitterFiles";

const zero = "0".repeat(40);
const blob = (n: number) => String(n).repeat(40);

const record = (
  modes: [string, string],
  blobs: [string, string],
  status: string,
  ...paths: string[]
) =>
  `:${modes[0]} ${modes[1]} ${blobs[0]} ${blobs[1]} ${status}\0${paths.join("\0")}\0`;

const regular: [string, string] = ["100644", "100644"];

describe("The formatting limits", () => {
  it("are the ones ADR 0048 sets", () => {
    assert.deepStrictEqual(formattingLimits, {
      maxBytes: 1024 * 1024,
      fileMs: 500,
      changeMs: 15_000,
      retryMs: 5000,
    });
  });
});

describe("Formatting candidates", () => {
  it("are the modified files and the moves git pairs, with the blobs on each side", () => {
    const raw = [
      record(regular, [blob(1), blob(2)], "M", "src/a.ts"),
      record(regular, [blob(3), blob(4)], "R087", "old/b.ts", "new/b.ts"),
      record(["100755", "100755"], [blob(5), blob(6)], "M", "run.sh"),
    ].join("");
    assert.deepStrictEqual(candidatesIn(raw), [
      {
        basePath: "src/a.ts",
        baseBlob: blob(1),
        headPath: "src/a.ts",
        headBlob: blob(2),
        moved: false,
      },
      {
        basePath: "old/b.ts",
        baseBlob: blob(3),
        headPath: "new/b.ts",
        headBlob: blob(4),
        moved: true,
      },
      {
        basePath: "run.sh",
        baseBlob: blob(5),
        headPath: "run.sh",
        headBlob: blob(6),
        moved: false,
      },
    ]);
  });

  it("leave out added and deleted files, copies, and exact renames", () => {
    const raw = [
      record(["000000", "100644"], [zero, blob(1)], "A", "added.ts"),
      record(["100644", "000000"], [blob(2), zero], "D", "deleted.ts"),
      record(regular, [blob(3), blob(4)], "C075", "from.ts", "copy.ts"),
      record(regular, [blob(5), blob(5)], "R100", "old.ts", "new.ts"),
    ].join("");
    assert.deepStrictEqual(candidatesIn(raw), []);
  });

  it("leave out a change of mode, even with an edit, and anything but an ordinary file", () => {
    const raw = [
      record(
        ["100644", "100755"],
        [blob(1), blob(2)],
        "M",
        "became-executable.sh"
      ),
      record(["100644", "120000"], [blob(3), blob(4)], "T", "became-link"),
      record(["120000", "120000"], [blob(5), blob(6)], "M", "link"),
      record(["160000", "160000"], [blob(7), blob(8)], "M", "submodule"),
      record(["100644", "100755"], [blob(9), blob(1)], "R090", "a.sh", "b.sh"),
    ].join("");
    assert.deepStrictEqual(candidatesIn(raw), []);
  });

  it("leave out a file whose blob didn't change", () => {
    assert.deepStrictEqual(
      candidatesIn(record(regular, [blob(1), blob(1)], "M", "same.ts")),
      []
    );
  });

  it("read nothing from output that isn't a record", () => {
    assert.deepStrictEqual(candidatesIn(""), []);
    assert.deepStrictEqual(candidatesIn("garbage\0text\0"), []);
  });
});

/** A repository in a temporary folder, with the helpers the tests below share. */
function repository(prefix: string) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
  const git = (...args: string[]) =>
    cp.execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  const write = (file: string, text: string | Buffer) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  };
  const remove = (file: string) => fs.rmSync(path.join(dir, file));
  const commit = (message: string) => {
    git("add", "-A");
    git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "reviewer@example.com");
  git("config", "user.name", "Reviewer");
  git("config", "commit.gpgsign", "false");
  return {
    dir,
    git,
    write,
    remove,
    commit,
    blob: (rev: string, file: string) => git("rev-parse", `${rev}:${file}`),
    changeOf: (base: string, head: string) =>
      ({
        repository: dir,
        mergeBase: base,
        headSha: head,
      }) as unknown as Change,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

describe("Reading the versions of a file", () => {
  const repo = repository("dr-read-blobs-");
  repo.write("a.txt", "one\n");
  repo.write("b.txt", "two\n");
  repo.write("big.txt", "x".repeat(2000));
  repo.write("latin1.txt", Buffer.from([0x61, 0xe9, 0x62]));
  repo.write("bom.txt", Buffer.from([0xef, 0xbb, 0xbf, 0x61]));
  repo.write("empty.txt", "");
  repo.commit("base");
  const blobOf = (file: string) => repo.blob("HEAD", file);

  after(repo.cleanup);

  it("gives the text of both", async () => {
    assert.deepStrictEqual(
      await readBlobs(repo.dir, [blobOf("a.txt"), blobOf("b.txt")], 1000),
      ["one\n", "two\n"]
    );
  });

  it("gives an empty file as empty text", async () => {
    assert.deepStrictEqual(
      await readBlobs(repo.dir, [blobOf("empty.txt"), blobOf("a.txt")], 1000),
      ["", "one\n"]
    );
  });

  it("keeps a byte order mark in the text, so a parser sees it", async () => {
    const [bom] = (await readBlobs(
      repo.dir,
      [blobOf("bom.txt"), blobOf("a.txt")],
      1000
    ))!;
    assert.strictEqual(bom, "﻿a");
  });

  it("gives nothing when either is over the size limit", async () => {
    assert.strictEqual(
      await readBlobs(repo.dir, [blobOf("a.txt"), blobOf("big.txt")], 1000),
      null
    );
    assert.strictEqual(
      await readBlobs(repo.dir, [blobOf("big.txt"), blobOf("a.txt")], 1000),
      null
    );
    assert.ok(
      await readBlobs(repo.dir, [blobOf("big.txt"), blobOf("a.txt")], 2000),
      "a file of exactly the limit is read"
    );
  });

  it("gives nothing when either isn't valid UTF-8", async () => {
    assert.strictEqual(
      await readBlobs(repo.dir, [blobOf("a.txt"), blobOf("latin1.txt")], 1000),
      null
    );
  });

  it("gives null for a blob the repository doesn't have, and undefined when it can't ask", async () => {
    assert.strictEqual(
      await readBlobs(repo.dir, [blobOf("a.txt"), "f".repeat(40)], 1000),
      null
    );
    assert.strictEqual(
      await readBlobs(
        path.join(repo.dir, "missing"),
        [blobOf("a.txt"), blobOf("b.txt")],
        1000
      ),
      undefined
    );
  });
});

const modified = (p: string): ChangedFile => ({ path: p, status: "modified" });
const added = (p: string): ChangedFile => ({ path: p, status: "added" });
const deleted = (p: string): ChangedFile => ({ path: p, status: "deleted" });

/** Says two versions differ in formatting only when they're the same without whitespace. */
const squash = (
  calls: Parameters<CompareFormatting>[0][] = []
): CompareFormatting => {
  return async (job) => {
    calls.push(job);
    return job.base.replace(/\s/g, "") === job.head.replace(/\s/g, "");
  };
};

describe("Formatting marks of a real Change", () => {
  const repo = repository("dr-formatting-marks-");
  const imports =
    'import a from "a";\nimport b from "b";\nimport c from "c";\n';
  repo.write("src/reformatted.ts", "const a={b:1};\n");
  repo.write("src/edited.ts", "const a = 1;\n");
  repo.write(
    "old/moved.ts",
    `${imports}export const x={y:1};\nexport const z=2;\n`
  );
  repo.write(
    "old/moved-edited.ts",
    `${imports}export const x={y:1};\nexport const z=2;\n`
  );
  repo.write("notes.md", "# Notes\n\ntext\n");
  repo.write("page.html", "<p>a</p>\n");
  repo.write("package-lock.json", '{"a":1}\n');
  repo.write("gen/api.ts", "const g={};\n");
  repo.write("run.sh", "echo a\n");
  const base = repo.commit("base");

  repo.write("src/reformatted.ts", "const a = {\n  b: 1\n};\n");
  repo.write("src/edited.ts", "const a = 2;\n");
  repo.remove("old/moved.ts");
  repo.write(
    "new/moved.ts",
    `${imports}export const x = {\n  y: 1\n};\nexport const z = 2;\n`
  );
  repo.remove("old/moved-edited.ts");
  repo.write(
    "new/moved-edited.ts",
    `${imports}export const x = {\n  y: 1\n};\nexport const z = 3;\n`
  );
  repo.write("notes.md", "# Notes\n\n\ntext\n");
  repo.write("page.html", "<p>\n  a\n</p>\n");
  repo.write("package-lock.json", '{\n  "a": 1\n}\n');
  repo.write("gen/api.ts", "const g = {};\n");
  fs.chmodSync(path.join(repo.dir, "run.sh"), 0o755);
  repo.write("run.sh", "echo   a\n");
  const head = repo.commit("head");
  const change = repo.changeOf(base, head);
  const files: ChangedFile[] = [
    modified("src/reformatted.ts"),
    modified("src/edited.ts"),
    deleted("old/moved.ts"),
    added("new/moved.ts"),
    deleted("old/moved-edited.ts"),
    added("new/moved-edited.ts"),
    modified("notes.md"),
    modified("page.html"),
    modified("package-lock.json"),
    modified("gen/api.ts"),
    modified("run.sh"),
  ];

  after(repo.cleanup);

  const marksOf = (found: ReadonlyMap<string, string>) =>
    Object.fromEntries([...found].sort(([a], [b]) => (a < b ? -1 : 1)));

  it("marks a modified file and both halves of a moved one whose versions the comparison says are the same, and no other", async () => {
    const calls: Parameters<CompareFormatting>[0][] = [];
    const marks = new FormattingMarks({
      compare: squash(calls),
      changed: () => {},
    });

    await marks.start(
      change,
      files,
      new Set(["gen/api.ts", "package-lock.json"])
    );

    assert.deepStrictEqual(marksOf(marks.ready(change)), {
      "src/reformatted.ts": "formatting",
      "old/moved.ts": "movedFormatting",
      "new/moved.ts": "movedFormatting",
    });
    marks.dispose();
  });

  it("sends a version only in a language with a grammar, and not a file that already has a reason or whose mode changed", async () => {
    const calls: Parameters<CompareFormatting>[0][] = [];
    const marks = new FormattingMarks({
      compare: squash(calls),
      changed: () => {},
    });

    await marks.start(
      change,
      files,
      new Set(["gen/api.ts", "package-lock.json"])
    );

    assert.deepStrictEqual(
      calls.map((c) => c.grammar),
      ["typescript", "typescript", "typescript", "typescript"]
    );
    assert.deepStrictEqual(
      calls.map((c) => c.head.split("\n").slice(-2)[0]).sort(),
      [
        "const a = 2;",
        "export const z = 2;",
        "export const z = 3;",
        "};",
      ].sort()
    );
    assert.ok(calls.every((c) => c.budgetMs === formattingLimits.fileMs));
    marks.dispose();
  });

  it("marks the files a real comparison finds reformatted, in a worker thread, and not a moved file with an edit", async () => {
    const wasmDir = copyWasmFiles(
      fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "dr-wasm-"))
    );
    const worker = new FormattingWorker({
      file: path.resolve("out/unit/src/formattingWorker.js"),
      wasmDir,
    });
    const marks = new FormattingMarks({
      compare: worker.compare,
      changed: () => {},
    });
    try {
      await marks.start(
        change,
        files,
        new Set(["gen/api.ts", "package-lock.json"])
      );

      assert.deepStrictEqual(marksOf(marks.ready(change)), {
        "src/reformatted.ts": "formatting",
        "old/moved.ts": "movedFormatting",
        "new/moved.ts": "movedFormatting",
      });
    } finally {
      marks.dispose();
      worker.dispose();
      fs.rmSync(wasmDir, { recursive: true, force: true });
    }
  });

  it("marks nothing for a file the Change doesn't list", async () => {
    const marks = new FormattingMarks({ compare: squash(), changed: () => {} });

    await marks.start(change, [modified("src/edited.ts")], new Set());

    assert.deepStrictEqual(marksOf(marks.ready(change)), {});
    marks.dispose();
  });

  it("tells the views once marks have been added, not once for each", async () => {
    let told = 0;
    const marks = new FormattingMarks({
      compare: squash(),
      changed: () => (told += 1),
    });

    await marks.start(change, files, new Set());
    assert.strictEqual(told, 0, "not before a timer has run");
    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.strictEqual(told, 1);
    marks.dispose();
  });

  it("looks at a Change once, and gives the marks it has before it's done", async () => {
    const calls: Parameters<CompareFormatting>[0][] = [];
    const marks = new FormattingMarks({
      compare: squash(calls),
      changed: () => {},
    });
    assert.deepStrictEqual(marksOf(marks.ready(change)), {});

    const first = marks.start(change, files, new Set());
    const second = marks.start(change, files, new Set());
    await Promise.all([first, second]);

    assert.strictEqual(calls.length, 6);
    marks.dispose();
  });

  it("keeps each pair of blobs' answer, so another Change with them isn't compared again", async () => {
    const calls: Parameters<CompareFormatting>[0][] = [];
    const marks = new FormattingMarks({
      compare: squash(calls),
      changed: () => {},
    });
    await marks.start(change, files, new Set());
    const compared = calls.length;
    repo.write("later.txt", "a later commit\n");
    const later = repo.changeOf(base, repo.commit("later"));

    await marks.start(later, [...files, added("later.txt")], new Set());

    assert.strictEqual(calls.length, compared, "no pair was compared twice");
    assert.deepStrictEqual(
      marksOf(marks.ready(later)),
      marksOf(marks.ready(change)),
      "the new head has the same marks"
    );
    marks.dispose();
  });

  it("marks no file when the comparison gives no answer, and tries again for another Change", async () => {
    let answer: boolean | undefined;
    const marks = new FormattingMarks({
      compare: async () => answer,
      changed: () => {},
    });
    await marks.start(change, files, new Set());
    assert.deepStrictEqual(marksOf(marks.ready(change)), {});
    answer = true;
    repo.write("another.txt", "another\n");
    const another = repo.changeOf(base, repo.commit("another"));

    await marks.start(another, [...files, added("another.txt")], new Set());

    assert.ok(
      "src/reformatted.ts" in marksOf(marks.ready(another)),
      "an unanswered pair wasn't remembered as no"
    );
    marks.dispose();
  });

  it("marks no file when the comparison says no, or throws", async () => {
    const no = new FormattingMarks({
      compare: async () => false,
      changed: () => {},
    });
    await no.start(change, files, new Set());
    assert.deepStrictEqual(marksOf(no.ready(change)), {});
    no.dispose();

    const throws = new FormattingMarks({
      compare: async () => {
        throw new Error("the worker is gone");
      },
      changed: () => {},
    });
    await throws.start(change, files, new Set());
    assert.deepStrictEqual(marksOf(throws.ready(change)), {});
    throws.dispose();
  });

  it("marks no file when git can't list the Change's changes", async () => {
    const lost = {
      repository: path.join(repo.dir, "missing"),
      mergeBase: base,
      headSha: head,
    } as unknown as Change;
    const marks = new FormattingMarks({ compare: squash(), changed: () => {} });

    await marks.start(lost, files, new Set());

    assert.deepStrictEqual(marksOf(marks.ready(lost)), {});
    marks.dispose();
  });

  it("asks again for a Change's changes after a failure, and not before", async () => {
    const spent = formattingLimits.retryMs;
    const later = path.join(repo.dir, "..", `${path.basename(repo.dir)}-later`);
    const lost = {
      repository: later,
      mergeBase: base,
      headSha: head,
    } as unknown as Change;
    const marks = new FormattingMarks({ compare: squash(), changed: () => {} });
    try {
      await marks.start(lost, files, new Set());
      assert.deepStrictEqual(marksOf(marks.ready(lost)), {});
      fs.cpSync(repo.dir, later, { recursive: true });

      formattingLimits.retryMs = 60_000;
      await marks.start(lost, files, new Set());
      assert.deepStrictEqual(marksOf(marks.ready(lost)), {}, "not yet");

      formattingLimits.retryMs = 0;
      await marks.start(lost, files, new Set());
      assert.ok("src/reformatted.ts" in marksOf(marks.ready(lost)));
    } finally {
      formattingLimits.retryMs = spent;
      marks.dispose();
      fs.rmSync(later, { recursive: true, force: true });
    }
  });

  it("stops when the Change's time has run out, and the files not reached get no mark", async () => {
    const spent = formattingLimits.changeMs;
    formattingLimits.changeMs = 0;
    try {
      const calls: Parameters<CompareFormatting>[0][] = [];
      const marks = new FormattingMarks({
        compare: squash(calls),
        changed: () => {},
      });

      await marks.start(change, files, new Set());

      assert.strictEqual(calls.length, 0);
      assert.deepStrictEqual(marksOf(marks.ready(change)), {});
      marks.dispose();
    } finally {
      formattingLimits.changeMs = spent;
    }
  });

  it("marks no file with a version over the size limit, and doesn't send it", async () => {
    const limit = formattingLimits.maxBytes;
    formattingLimits.maxBytes = 20;
    try {
      const calls: Parameters<CompareFormatting>[0][] = [];
      const marks = new FormattingMarks({
        compare: squash(calls),
        changed: () => {},
      });

      await marks.start(change, files, new Set());

      assert.ok(
        calls.every((c) => c.base.length <= 20 && c.head.length <= 20),
        JSON.stringify(calls)
      );
      assert.ok(!("new/moved.ts" in marksOf(marks.ready(change))));
      marks.dispose();
    } finally {
      formattingLimits.maxBytes = limit;
    }
  });
});

describe("The formatting worker", () => {
  const wasmDir = copyWasmFiles(
    fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "dr-wasm-"))
  );
  const workerFile = path.resolve("out/unit/src/formattingWorker.js");
  const job = (base: string, head: string, budgetMs = 5000) => ({
    grammar: "javascript" as const,
    base,
    head,
    budgetMs,
  });
  const started: FormattingWorker[] = [];
  const worker = (file = workerFile, graceMs?: number) => {
    const w = new FormattingWorker({
      file,
      wasmDir,
      ...(graceMs && { graceMs }),
    });
    started.push(w);
    return w;
  };

  after(() => {
    for (const w of started) w.dispose();
    fs.rmSync(wasmDir, { recursive: true, force: true });
  });

  it("answers each job in a thread of its own, one after another", async () => {
    const w = worker();

    const answers = await Promise.all([
      w.compare(job("a=1;\n", "a = 1;\n")),
      w.compare(job("a=1;\n", "a = 2;\n")),
      w.compare({ ...job("x = 1\n", "x  =  1\n"), grammar: "python" }),
    ]);

    assert.deepStrictEqual(answers, [true, false, true]);
  });

  it("gives no answer for a job whose time is up, and goes on to the next", async () => {
    const w = worker();
    const lines = "a = 1;\n".repeat(200_000);

    assert.strictEqual(
      await w.compare(job(lines, lines.replace(/ = /g, "  =  "), 10)),
      undefined
    );
    assert.strictEqual(await w.compare(job("a=1;\n", "a = 1;\n")), true);
  });

  it("gives no answer, and not an error, when the worker can't start", async () => {
    const w = worker(path.join(wasmDir, "missing.js"));

    for (let i = 0; i < 5; i++)
      assert.strictEqual(await w.compare(job("a=1;\n", "a = 1;\n")), undefined);
  });

  it("ends a worker that stops answering, and gives up on it after it fails again and again", async () => {
    const hung = path.join(wasmDir, "hung.js");
    fs.writeFileSync(hung, "for (;;) {}\n");
    const w = worker(hung, 100);

    for (let i = 0; i < 4; i++)
      assert.strictEqual(
        await w.compare(job("a=1;\n", "a = 1;\n", 50)),
        undefined
      );
  });

  it("starts another worker after one crashes", async () => {
    const w = worker();
    assert.strictEqual(await w.compare(job("a=1;\n", "a = 1;\n")), true);
    // The crash of the thread is its exit, whatever the cause.
    (
      w as unknown as { worker: { terminate(): Promise<number> } }
    ).worker.terminate();
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.strictEqual(await w.compare(job("a=1;\n", "a = 1;\n")), true);
  });

  it("gives no answer once disposed", async () => {
    const w = worker();
    w.dispose();

    assert.strictEqual(await w.compare(job("a=1;\n", "a = 1;\n")), undefined);
  });
});
