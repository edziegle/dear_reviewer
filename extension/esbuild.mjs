import { build } from "esbuild";

await build({
  // The git tools' MCP server runs in a process of its own (ADR 0030).
  entryPoints: {
    extension: "src/extension.ts",
    gitServer: "src/assistant/gitServer.ts",
  },
  bundle: true,
  outdir: "dist",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
});
