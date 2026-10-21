// Where the unit tests find the `.wasm` files that the build copies into
// `dist/tree-sitter/`: in the dev dependencies they're copied from. Mocha runs
// in `extension/`.

import * as fs from "fs";
import * as path from "path";
import grammars from "../../src/grammars.json";
import { grammarWasms, runtimeWasm } from "../../src/formattingGrammars";

export function wasmFromNodeModules(name: string): string {
  if (name === runtimeWasm)
    return path.resolve("node_modules/web-tree-sitter", name);
  const grammar = Object.values(grammars).find((g) => g.wasm === name);
  if (!grammar) throw new Error(`No grammar has the file ${name}`);
  return path.resolve("node_modules", grammar.package, name);
}

/**
 * A folder holding the runtime's `.wasm` and every grammar's, laid out as the
 * build lays out `dist/tree-sitter/`, for a worker's `wasmDir`.
 */
export function copyWasmFiles(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  for (const name of [runtimeWasm, ...grammarWasms])
    fs.copyFileSync(wasmFromNodeModules(name), path.join(dir, name));
  return dir;
}
