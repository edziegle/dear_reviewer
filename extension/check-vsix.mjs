// Checks the packaged .vsix holds what formatting-only marks need (ADR 0048)
// and that it works from the .vsix alone: the worker, the tree-sitter
// runtime and every grammar's .wasm file are in it, and the worker loads the
// runtime and a grammar from where the .vsix puts them. Run by the package
// task, so a .vsix that would leave a grammar out fails the build.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";

const [vsix] = process.argv.slice(2);
if (!vsix) throw new Error("Usage: node check-vsix.mjs <file.vsix>");

const grammars = JSON.parse(readFileSync("src/grammars.json", "utf8"));
const expected = [
  "extension/dist/formattingWorker.js",
  "extension/dist/tree-sitter/web-tree-sitter.wasm",
  ...Object.values(grammars).map(
    ({ wasm }) => `extension/dist/tree-sitter/${wasm}`
  ),
];

const listed = new Set(
  execFileSync("unzip", ["-Z1", vsix], { encoding: "utf8" }).split("\n")
);
const missing = expected.filter((file) => !listed.has(file));
if (missing.length > 0)
  throw new Error(`${vsix} is missing:\n${missing.join("\n")}`);
console.log(
  `${vsix} holds the worker, the runtime and ${Object.keys(grammars).length} grammars`
);

const dir = mkdtempSync(path.join(tmpdir(), "dear-reviewer-vsix-"));
try {
  execFileSync("unzip", ["-q", vsix, "extension/dist/*", "-d", dir]);
  const dist = path.join(dir, "extension", "dist");
  const worker = new Worker(path.join(dist, "formattingWorker.js"), {
    workerData: { wasmDir: path.join(dist, "tree-sitter") },
  });
  const answer = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The packaged worker didn't answer")),
      30_000
    );
    worker.on("error", reject);
    worker.on("message", (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    worker.postMessage({
      id: 1,
      grammar: "javascript",
      base: "a=1;\n",
      head: "a = 1;\n",
      budgetMs: 5000,
    });
  });
  await worker.terminate();
  if (answer.formattingOnly !== true)
    throw new Error(
      `The packaged worker didn't load the runtime and a grammar: ${JSON.stringify(answer)}`
    );
  console.log("the packaged worker loads the runtime and a grammar");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
