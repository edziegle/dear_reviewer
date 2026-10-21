// The grammars Dear Reviewer ships for comparing file versions (ADR 0048), and
// which file goes with which. Nothing here loads tree-sitter, so the extension
// host can ask which files to send to the worker.

import grammars from "./grammars.json";

export type GrammarName = keyof typeof grammars;

/** What grammars.json says of a grammar. */
interface Grammar {
  /** The npm package the build copies the `.wasm` file from. */
  package: string;
  wasm: string;
  extensions: string[];
  /**
   * Whether the whitespace between two leaves must stay of the same shape:
   * nothing, whitespace on a line, or a line break. For a grammar that reads a
   * line break as a space, or `[a` as `[ a`.
   */
  gapShape?: boolean;
  /** Whether indentation is syntax, so the statements' indentations must stand for each other. */
  indentation?: boolean;
  /** Whether a token that starts with `#` is a directive that begins its line. */
  directives?: boolean;
}

export const grammarTable: Record<GrammarName, Grammar> = grammars;

const byExtension = new Map<string, GrammarName>(
  (Object.keys(grammars) as GrammarName[]).flatMap((name) =>
    grammars[name].extensions.map((extension) => [extension, name] as const)
  )
);

/** The grammar for a file by its extension, if one ships. */
export function grammarOfPath(filePath: string): GrammarName | undefined {
  const name = filePath.slice(filePath.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot < 0 ? undefined : byExtension.get(name.slice(dot).toLowerCase());
}

/** The runtime's own `.wasm`, which `Parser.init` asks for. */
export const runtimeWasm = "web-tree-sitter.wasm";

/** The `.wasm` file of a grammar, as the build copies it. */
export function wasmOf(name: GrammarName): string {
  return grammarTable[name].wasm;
}

/** The `.wasm` file of every grammar. */
export const grammarWasms: readonly string[] = (
  Object.keys(grammars) as GrammarName[]
).map(wasmOf);
