// Formatting-only files among the skim-only files (ADR 0048), against a real
// repository under plain Node, with a stand-in for the worker that parses.

import * as assert from "assert";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { Change, ChangedFile } from "../../src/changeDetails";
import { FormattingMarks } from "../../src/formattingMarks";
import {
  skimOnlyFiles,
  skimOnlyOf,
  skimReasonText,
  useFormattingMarks,
} from "../../src/skimOnly";

const modified = (p: string): ChangedFile => ({ path: p, status: "modified" });

describe("Skim-only files with formatting marks", () => {
  const dir = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "dr-skim-formatting-")
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
  write("src/reformatted.ts", "const a={b:1};\n");
  write("src/edited.ts", "const a = 1;\n");
  write("package-lock.json", '{"a":1}\n');
  const base = commit("base");
  write("src/reformatted.ts", "const a = {\n  b: 1\n};\n");
  write("src/edited.ts", "const a = 2;\n");
  write("package-lock.json", '{\n  "a": 1\n}\n');
  const head = commit("head");
  const change = {
    repository: dir,
    mergeBase: base,
    headSha: head,
  } as unknown as Change;
  const files = [
    "package-lock.json",
    "src/edited.ts",
    "src/reformatted.ts",
  ].map(modified);

  afterEach(() => useFormattingMarks(undefined));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("have the rules git answers first, and a formatting-only file once its mark is found, with a lock file keeping its own reason", async () => {
    const marks = new FormattingMarks({
      compare: async (job) =>
        job.base.replace(/\s/g, "") === job.head.replace(/\s/g, ""),
      changed: () => {},
    });
    useFormattingMarks(marks);

    const before = await skimOnlyOf(change, files);
    await marks.start(change, files, new Set(before.keys()));
    const after = await skimOnlyOf(change, files);

    assert.deepStrictEqual(Object.fromEntries(before), {
      "package-lock.json": "lockFile",
    });
    assert.deepStrictEqual(Object.fromEntries(after), {
      "package-lock.json": "lockFile",
      "src/reformatted.ts": "formatting",
    });
    marks.dispose();
  });

  it("are the rules alone when no formatting marks are in use", async () => {
    useFormattingMarks(undefined);

    assert.deepStrictEqual(
      Object.fromEntries(await skimOnlyOf(change, files)),
      { "package-lock.json": "lockFile" }
    );
  });

  it("put a formatting-only file after every other reason", () => {
    const skim = skimOnlyFiles({
      files: [
        modified("a.ts"),
        modified("b.ts"),
        modified("c.ts"),
        modified("d.ts"),
      ],
      generated: new Set(["a.ts"]),
      renamed: new Set(["b.ts"]),
      formatting: new Map([
        ["a.ts", "formatting"],
        ["b.ts", "movedFormatting"],
        ["c.ts", "movedFormatting"],
        ["d.ts", "formatting"],
      ]),
    });
    assert.deepStrictEqual(Object.fromEntries(skim), {
      "a.ts": "generated",
      "b.ts": "renamed",
      "c.ts": "movedFormatting",
      "d.ts": "formatting",
    });
  });

  it("say why in words", () => {
    assert.strictEqual(skimReasonText.formatting, "formatting only");
    assert.strictEqual(
      skimReasonText.movedFormatting,
      "moved, formatting only"
    );
  });
});
