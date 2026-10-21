// The extension host's main thread never parses (ADR 0048): the tree-sitter
// runtime and the comparison are bundled into the worker alone, so the only
// modules that may import them are the worker's own, and the others may name
// the worker's types but not run it.

import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

function sourceFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? sourceFiles(path.join(dir, entry.name))
        : entry.name.endsWith(".ts")
          ? [path.join(dir, entry.name)]
          : []
    );
}

interface Import {
  file: string;
  specifier: string;
  typeOnly: boolean;
}

/** Every import and re-export of the files under `src/`, however many lines it takes. */
function imports(): Import[] {
  return sourceFiles(path.resolve("src")).flatMap((file) =>
    [
      ...fs
        .readFileSync(file, "utf8")
        .matchAll(
          /\b(import|export)(\s+type)?\s[^;]*?\sfrom\s*["']([^"']+)["']/g
        ),
    ].map((match) => ({
      file: path.basename(file),
      specifier: match[3],
      typeOnly: match[2] !== undefined,
    }))
  );
}

const importersOf = (specifier: RegExp, valuesOnly = false) =>
  imports()
    .filter((i) => specifier.test(i.specifier) && !(valuesOnly && i.typeOnly))
    .map((i) => i.file)
    .sort();

describe("The formatting-only comparison's place in the extension", () => {
  it("is imported by the worker alone", () => {
    assert.deepStrictEqual(importersOf(/(^|\/)formattingOnly$/), [
      "formattingWorker.ts",
    ]);
  });

  it("brings in the tree-sitter runtime through the comparison alone", () => {
    assert.deepStrictEqual(importersOf(/^web-tree-sitter$/), [
      "formattingOnly.ts",
    ]);
  });

  it("is run by no module, which only name its types", () => {
    assert.deepStrictEqual(importersOf(/(^|\/)formattingWorker$/, true), []);
    assert.ok(importersOf(/(^|\/)formattingWorker$/).length > 0);
  });
});
