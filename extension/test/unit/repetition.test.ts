// Repeated edits and Duplicate code (ADR 0047), from normalized lines, under
// plain Node.

import * as assert from "assert";
import {
  duplicateCandidates,
  hasContent,
  maxCandidates,
  normalizeLines,
  RepositoryIndex,
  repeatedEdits,
  type Hunk,
} from "../../src/repetition";

const normalized = (...lines: string[]) => normalizeLines(lines);

describe("Normalizing lines", () => {
  it("gives two lines that differ only in names, numbers, strings or spacing the same text", () => {
    const [a, b, c] = normalized(
      'result = compute(first, 12, "one")',
      "  total=compute( second,99,'two' )  ",
      "value = 0x1F + item.count"
    );
    assert.strictEqual(a, b);
    assert.notStrictEqual(a, c);
  });

  it("tells lines of different shape apart", () => {
    const [call, assignment, nested] = normalized(
      "run(a)",
      "run = a",
      "run(a(b))"
    );
    assert.notStrictEqual(call, assignment);
    assert.notStrictEqual(call, nested);
  });

  it("drops blank lines and lines that are only a comment, whatever the language", () => {
    assert.deepStrictEqual(
      normalized(
        "",
        "   ",
        "// c",
        "# python",
        "-- sql",
        "/* one-line block */",
        "/*",
        " * javadoc",
        " */",
        "x = 1"
      ),
      ["", "", "", "", "", "", "", "", "", normalized("x = 1")[0]]
    );
  });

  it("drops the rest of a line after a trailing comment", () => {
    const [bare, slashes, hash, block] = normalized(
      "x = 1",
      "x = 1 // note",
      "x = 1 # note",
      "x = /* note */ 1"
    );
    assert.strictEqual(slashes, bare);
    assert.strictEqual(hash, bare);
    assert.strictEqual(block, bare);
  });

  it("keeps comment markers inside strings, and preprocessor and attribute lines", () => {
    const [url, include, attribute] = normalized(
      'u = "http://example.com"',
      "#include <stdio.h>",
      "#[derive(Debug)]"
    );
    assert.ok(hasContent(url));
    assert.ok(hasContent(include));
    assert.ok(hasContent(attribute));
  });

  it("ends a block comment that spans lines where it closes", () => {
    assert.deepStrictEqual(
      normalizeLines(["a = 1 /* starts", "still in it", "ends */ b = 2"]),
      [normalized("a = 1")[0], "", normalized("b = 2")[0]]
    );
  });

  it("takes a glob such as dist/* for no block comment, and keeps the lines after it", () => {
    const [glob, after] = normalizeLines(["rm -rf dist/*", "x = 1"]);
    assert.ok(hasContent(glob));
    assert.strictEqual(after, normalized("x = 1")[0]);
    const [yaml, rest] = normalizeLines(["paths: [src/*]", "name: build"]);
    assert.ok(hasContent(yaml));
    assert.ok(hasContent(rest));
  });

  it("takes a /* that nothing closes for no comment, so it hides no later line", () => {
    const [opened, after] = normalizeLines(["run /* never closed", "x = 1"]);
    assert.ok(hasContent(opened));
    assert.strictEqual(after, normalized("x = 1")[0]);
  });

  it("says a line has content only when it holds a name, number or string", () => {
    for (const line of ["}", "});", "];", "{"]) {
      assert.ok(!hasContent(normalized(line)[0]), line);
    }
    for (const line of ["run();", "x = 1", "'s'", "return"]) {
      assert.ok(hasContent(normalized(line)[0]), line);
    }
  });
});

const hunk = (
  path: string,
  line: number,
  removed: string[],
  added: string[],
  status: Hunk["status"] = "modified"
): Hunk => ({
  path,
  status,
  oldStart: line,
  removed,
  newStart: line,
  added,
});

/** A sweep of `legacy(x)` to `modern(x)` at these files, with the first line number. */
function sweep(...files: string[]): Hunk[] {
  return files.map((path, i) =>
    hunk(path, 3, [`legacy(arg${i})`], [`modern(arg${i})`])
  );
}

describe("Repeated edits", () => {
  it("are an edit at 3 or more sites, and not at 2", async () => {
    const three = await repeatedEdits(sweep("a.py", "b.py", "c.py"));
    assert.strictEqual(three.length, 1);
    assert.deepStrictEqual(
      three[0].sites.map((s) => s.path),
      ["a.py", "b.py", "c.py"]
    );
    assert.deepStrictEqual(three[0].differing, []);
    assert.deepStrictEqual(three[0].missed, []);
    assert.deepStrictEqual(await repeatedEdits(sweep("a.py", "b.py")), []);
  });

  it("count a site for each hunk, and group by what the hunks removed, whatever the names", async () => {
    const edits = await repeatedEdits([
      ...sweep("a.py", "b.py", "c.py"),
      hunk("a.py", 20, ["legacy(other)"], ["modern(other)"]),
      hunk("d.py", 1, ["unrelated(1)"], ["x"]),
    ]);
    assert.strictEqual(edits.length, 1);
    assert.strictEqual(edits[0].sites.length, 4);
    assert.deepStrictEqual(edits[0].sites[3], {
      path: "a.py",
      side: "head",
      line: 20,
      endLine: 20,
    });
  });

  it("name a site that got other added lines as a differing site, and the sample is the majority's", async () => {
    const hunks = [
      ...sweep("a.py", "b.py", "c.py", "d.py"),
      hunk("e.py", 3, ["legacy(arg9)"], ["modern(arg9, True)"]),
    ];
    const [edit] = await repeatedEdits(hunks);
    assert.strictEqual(edit.sites.length, 5);
    assert.deepStrictEqual(
      edit.differing.map((s) => s.path),
      ["e.py"]
    );
    assert.deepStrictEqual(edit.majority, {
      removed: ["legacy(arg0)"],
      added: ["modern(arg0)"],
    });
  });

  it("find a site that got no added lines different from one that got none", async () => {
    const hunks = [
      hunk("a.py", 1, ["drop(1)"], []),
      hunk("b.py", 1, ["drop(2)"], []),
      hunk("c.py", 1, ["drop(3)"], []),
      hunk("d.py", 1, ["drop(4)"], ["keep(4)"]),
    ];
    const [edit] = await repeatedEdits(hunks);
    assert.deepStrictEqual(
      edit.differing.map((s) => s.path),
      ["d.py"]
    );
  });

  it("skip a group whose removed lines are only punctuation, or nothing", async () => {
    assert.deepStrictEqual(
      await repeatedEdits(
        ["a", "b", "c"].map((p) => hunk(`${p}.py`, 1, ["});", "}"], ["x"]))
      ),
      []
    );
    assert.deepStrictEqual(
      await repeatedEdits(
        ["a", "b", "c"].map((p) => hunk(`${p}.py`, 1, [], ["x"]))
      ),
      []
    );
  });

  it("find a missed site: a place in the index outside the hunks that still holds the removed lines", async () => {
    const index = new RepositoryIndex();
    index.add("a.py", "x = 1\ny = 2\nlegacy(arg0)\nmodern(2)\n");
    index.add("b.py", "# header\n\nlegacy(arg1)\n");
    index.add("c.py", "modern(3)\n");
    index.add("kept/d.py", "import os\n\ndef run():\n    legacy(thing)\n");
    const [edit] = await repeatedEdits(sweep("a.py", "b.py", "c.py"), {
      index,
    });
    assert.deepStrictEqual(edit.missed, [
      { path: "kept/d.py", line: 4, endLine: 4 },
    ]);
    assert.strictEqual(edit.moreMissed, 0);
  });

  it("find a missed site of removed lines over several lines, only where all of them are together", async () => {
    const removed = ["first(a)", "second(b)", "third(c)"];
    const hunks = ["a", "b", "c"].map((p) =>
      hunk(`${p}.py`, 1, removed, ["done()"])
    );
    const index = new RepositoryIndex();
    index.add("whole.py", "first(x)\n\n// between\nsecond(y)\nthird(z)\n");
    index.add("part.py", "first(x)\nsecond(y)\nother(z, w)\n");
    const [edit] = await repeatedEdits(hunks, { index });
    assert.deepStrictEqual(edit.missed, [
      { path: "whole.py", line: 1, endLine: 5 },
    ]);
  });

  it("don't take the added lines of a site for a missed one, when a rename leaves the lines the same after normalizing", async () => {
    const renamed = ["a", "b", "c"].map((p) =>
      hunk(`${p}.py`, 2, ["oldName(x)"], ["newName(x)"])
    );
    const index = new RepositoryIndex();
    for (const p of ["a", "b", "c"])
      index.add(`${p}.py`, `import z\nnewName(x)\n`);
    index.add("d.py", "oldName(y)\n");
    const [edit] = await repeatedEdits(renamed, { index });
    assert.deepStrictEqual(edit.missed, [
      { path: "d.py", line: 1, endLine: 1 },
    ]);
  });

  it("keep a missed site to the names every site's removed lines share, when it can read the lines", async () => {
    const renamed = sweep("a.py", "b.py", "c.py");
    const index = new RepositoryIndex();
    index.add("d.py", "legacy(a)\n");
    index.add("e.py", "other(a)\n");
    const texts: Record<string, string[]> = {
      "d.py": ["legacy(a)"],
      "e.py": ["other(a)"],
    };
    const [edit] = await repeatedEdits(renamed, {
      index,
      lineText: (path) => texts[path],
    });
    assert.deepStrictEqual(
      edit.missed.map((m) => m.path),
      ["d.py"]
    );
  });

  it("say the search was cut off when it stopped reading look-alike places before the last", async () => {
    const index = new RepositoryIndex();
    for (let i = 0; i < 2100; i++) index.add(`m${i}.py`, "other(a)\n");
    const read = ["other(a)"];
    const [edit] = await repeatedEdits(sweep("a.py", "b.py", "c.py"), {
      index,
      lineText: () => read,
    });
    assert.strictEqual(edit.cutOff, true);
    assert.deepStrictEqual(edit.missed, []);
    const [whole] = await repeatedEdits(sweep("a.py", "b.py", "c.py"), {
      index: new RepositoryIndex(),
    });
    assert.strictEqual(whole.cutOff, false);
  });

  it("find no missed site when the sites' removed lines share no name, as shape alone matches everywhere", async () => {
    const index = new RepositoryIndex();
    index.add("anywhere.py", "qux(4)\nquux(5)\n");
    const hunks = [
      hunk("a.py", 1, ["foo(1)"], ["x"]),
      hunk("b.py", 1, ["bar(2)"], ["x"]),
      hunk("c.py", 1, ["baz(3)"], ["x"]),
    ];
    const [edit] = await repeatedEdits(hunks, { index });
    assert.deepStrictEqual(edit.missed, []);
    assert.strictEqual(edit.cutOff, false);
  });

  it("list at most 20 missed sites and count the rest", async () => {
    const index = new RepositoryIndex();
    for (let i = 0; i < 25; i++)
      index.add(`m${String(i).padStart(2, "0")}.py`, `legacy(v${i})\n`);
    const [edit] = await repeatedEdits(sweep("a.py", "b.py", "c.py"), {
      index,
    });
    assert.strictEqual(edit.missed.length, 20);
    assert.strictEqual(edit.moreMissed, 5);
    assert.strictEqual(edit.missed[0].path, "m00.py");
  });

  it("put a site of a deleted file on the base side", async () => {
    const hunks = [
      hunk("a.py", 5, ["legacy(1)"], []),
      hunk("b.py", 5, ["legacy(2)"], []),
      hunk("gone.py", 7, ["legacy(3)"], [], "deleted"),
    ];
    const [edit] = await repeatedEdits(hunks);
    assert.deepStrictEqual(edit.sites[2], {
      path: "gone.py",
      side: "base",
      line: 7,
      endLine: 7,
    });
  });
});

/**
 * `count` statements of different shapes, such as a function's body. The
 * shapes differ in how deep the brackets nest, which normalizing keeps; the
 * names it doesn't, and `offset` makes a body of other shapes.
 */
const body = (name: string, count: number, offset = 0): string[] =>
  Array.from({ length: count }, (_, i) => {
    const depth = i + 1 + offset;
    return `    ${name}(${"[".repeat(depth)}${i}${"]".repeat(depth)});`;
  });

function sourceOf(...blocks: string[][]): string {
  return blocks.map((b) => b.join("\n")).join("\n// ---\n") + "\n";
}

/** The head lines of a file that are all added. */
const allAdded = (text: string): Set<number> =>
  new Set(text.split("\n").map((_, i) => i + 1));

describe("Duplicate code candidates", () => {
  // Statements in the shape of `original`, with other names.
  const original = [
    "function process(items) {",
    "  const seen = new Set();",
    "  for (const item of items) {",
    "    if (seen.has(item.id)) continue;",
    "    seen.add(item.id);",
    "    output.push(transform(item, 3));",
    "  }",
    "  return output;",
    "}",
  ];
  const renamed = original.map((line) =>
    line
      .replace("process", "handle")
      .replace(/items/g, "entries")
      .replace(/seen/g, "visited")
      .replace(/item\b/g, "entry")
      .replace("output", "results")
      .replace("3", "7")
  );

  it("find 6 or more normalized lines copied from an indexed file, with other names", () => {
    const index = new RepositoryIndex();
    index.add("src/old.js", sourceOf(["// the original"], original));
    const text = sourceOf(["const keep = 1;"], renamed);
    const found = duplicateCandidates({
      files: [{ path: "src/new.js", text, added: allAdded(text) }],
      index,
    });
    assert.strictEqual(found.length, 1);
    assert.deepStrictEqual(
      [found[0].path, found[0].startLine, found[0].endLine, found[0].lines],
      ["src/new.js", 3, 11, 9]
    );
    assert.deepStrictEqual(found[0].places, [
      { path: "src/old.js", line: 3, endLine: 11 },
    ]);
  });

  it("find a block of 6 and not one of 5", () => {
    const six = body("a", 6);
    const index = new RepositoryIndex();
    index.add("old.js", sourceOf(six));
    const copied = sourceOf(six);
    assert.strictEqual(
      duplicateCandidates({
        files: [{ path: "new.js", text: copied, added: allAdded(copied) }],
        index,
      }).length,
      1
    );
    const shorter = sourceOf(six.slice(0, 5));
    assert.strictEqual(
      duplicateCandidates({
        files: [{ path: "new.js", text: shorter, added: allAdded(shorter) }],
        index,
      }).length,
      0
    );
  });

  it("merge adjacent windows into one block", () => {
    const eight = body("a", 8);
    const index = new RepositoryIndex();
    index.add("old.js", sourceOf(eight));
    const text = sourceOf(eight);
    const found = duplicateCandidates({
      files: [{ path: "new.js", text, added: allAdded(text) }],
      index,
    });
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].lines, 8);
  });

  it("find only blocks of lines the Change added", () => {
    const block = body("a", 7);
    const index = new RepositoryIndex();
    index.add("old.js", sourceOf(block));
    const text = sourceOf(block);
    // The Change added all but the fourth line: no 6 added lines in a row.
    const added = allAdded(text);
    added.delete(4);
    assert.deepStrictEqual(
      duplicateCandidates({
        files: [{ path: "new.js", text, added }],
        index,
      }),
      []
    );
  });

  it("find a copy within the Change alone, once, naming the earlier block as the original", () => {
    const block = body("a", 6);
    const first = sourceOf(block);
    const second = sourceOf(["const keep = 1;"], block);
    const found = duplicateCandidates({
      files: [
        { path: "a.js", text: first, added: allAdded(first) },
        { path: "b.js", text: second, added: allAdded(second) },
      ],
    });
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].path, "b.js");
    assert.deepStrictEqual(found[0].places, [
      { path: "a.js", line: 1, endLine: 6 },
    ]);
  });

  it("find a copy of an earlier block of the same file, added or not, once", () => {
    const block = body("a", 6);
    const text = sourceOf(block, ["const gap = 1;"], body("b", 6));
    const second = new Set<number>();
    for (let line = 10; line <= 15; line++) second.add(line);
    const expected = [[10, [{ path: "f.js", line: 1, endLine: 6 }]]];
    assert.deepStrictEqual(
      duplicateCandidates({
        files: [{ path: "f.js", text, added: second }],
      }).map((c) => [c.startLine, c.places]),
      expected
    );
    assert.deepStrictEqual(
      duplicateCandidates({
        files: [{ path: "f.js", text, added: allAdded(text) }],
      }).map((c) => [c.startLine, c.places]),
      expected
    );
  });

  it("don't take a run of the same line for a copy of itself", () => {
    const text = sourceOf(Array.from({ length: 12 }, () => "  tick();"));
    assert.deepStrictEqual(
      duplicateCandidates({
        files: [{ path: "a.js", text, added: allAdded(text) }],
      }),
      []
    );
  });

  it("skip blocks that are mostly punctuation", () => {
    const braces = ["}", "});", "}", "});", "}", "});"];
    const index = new RepositoryIndex();
    index.add("old.js", sourceOf(braces));
    const text = sourceOf(braces);
    assert.deepStrictEqual(
      duplicateCandidates({
        files: [{ path: "new.js", text, added: allAdded(text) }],
        index,
      }),
      []
    );
  });

  it("keep a few of the places a block matches", () => {
    const block = body("a", 6);
    const index = new RepositoryIndex();
    for (let i = 0; i < 6; i++) index.add(`old${i}.js`, sourceOf(block));
    const text = sourceOf(block);
    const [found] = duplicateCandidates({
      files: [{ path: "new.js", text, added: allAdded(text) }],
      index,
    });
    assert.deepStrictEqual(
      found.places.map((p) => p.path),
      ["old0.js", "old1.js", "old2.js"]
    );
  });

  it("keep at most 20, the largest first", () => {
    const index = new RepositoryIndex();
    const files = [];
    for (let i = 0; i < 25; i++) {
      // Each copy has its own shape: `i` varies the calls, so they don't match each other.
      const shape = body("f", 6 + (i % 5), i * 10);
      index.add(`old${i}.js`, sourceOf(shape));
      const text = sourceOf(shape);
      files.push({ path: `new${i}.js`, text, added: allAdded(text) });
    }
    const found = duplicateCandidates({ files, index });
    assert.strictEqual(found.length, maxCandidates);
    const sizes = found.map((c) => c.lines);
    assert.deepStrictEqual(
      sizes,
      [...sizes].sort((a, b) => b - a)
    );
    assert.strictEqual(sizes[0], 10);
  });
});

describe("The repository index", () => {
  it("finds a sequence of normalized lines where it still sits, and only there", () => {
    const index = new RepositoryIndex();
    index.add("a.js", "one(1);\ntwo[2];\nthree(3);\n");
    index.add("b.js", "one(1);\nthree(3);\n");
    const found = index.occurrences(normalized("one(9);", "two[9];"));
    assert.deepStrictEqual(found, [{ path: "a.js", line: 1, endLine: 2 }]);
    assert.deepStrictEqual(index.occurrences(normalized("}", "}")), []);
    assert.deepStrictEqual(index.occurrences([]), []);
  });

  it("starts complete and says when it is partial", () => {
    const index = new RepositoryIndex();
    assert.strictEqual(index.partial, false);
    index.partial = true;
    assert.strictEqual(index.partial, true);
  });
});
