import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

await build({
  // The git tools' MCP server runs in a process of its own (ADR 0030), and the
  // comparison of file versions in a worker thread (ADR 0048).
  entryPoints: {
    extension: "src/extension.ts",
    gitServer: "src/assistant/gitServer.ts",
    formattingWorker: "src/formattingWorker.ts",
  },
  bundle: true,
  outdir: "dist",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
  // The package's ESM build finds its files through import.meta, which a
  // CommonJS bundle doesn't have.
  alias: {
    "web-tree-sitter": "./node_modules/web-tree-sitter/web-tree-sitter.cjs",
  },
});

// The runtime's and the grammars' .wasm files, which the worker loads from
// dist/tree-sitter/. They come from dev dependencies pinned in package.json,
// so nothing is installed with the extension and nothing is fetched while a
// Change is open. A package without its file fails the build.
const grammars = JSON.parse(readFileSync("src/grammars.json", "utf8"));
const wasmDir = path.join("dist", "tree-sitter");
rmSync(wasmDir, { recursive: true, force: true });
mkdirSync(wasmDir, { recursive: true });
copyFileSync(
  path.join("node_modules", "web-tree-sitter", "web-tree-sitter.wasm"),
  path.join(wasmDir, "web-tree-sitter.wasm")
);
for (const { package: pkg, wasm } of Object.values(grammars)) {
  copyFileSync(path.join("node_modules", pkg, wasm), path.join(wasmDir, wasm));
}
