// The `--vscode-*` variables of Default Dark Modern and Default Light Modern,
// which VS Code gives every webview, for the pages `capture.mjs` draws. A
// color comes from the theme's own file in VSCodium's install, and where the
// file leaves it to the workbench's default, from `defaults` below. A
// variable the sources use that neither knows is an error: add it to
// `defaults`.

import * as fs from "node:fs";
import * as path from "node:path";

const themeFiles = {
  dark: "dark_modern.json",
  light: "light_modern.json",
};

/** What the workbench gives a color the theme files leave out, for each theme. */
const defaults = {
  contrastBorder: { dark: "transparent", light: "transparent" },
  contrastActiveBorder: { dark: "transparent", light: "transparent" },
  "gitDecoration.addedResourceForeground": {
    dark: "#81b88b",
    light: "#587c0c",
  },
  "gitDecoration.modifiedResourceForeground": {
    dark: "#e2c08d",
    light: "#895503",
  },
  "gitDecoration.deletedResourceForeground": {
    dark: "#c74e39",
    light: "#ad0707",
  },
  "inputOption.activeForeground": { dark: "#ffffff", light: "#000000" },
  "inputValidation.errorBackground": { dark: "#5a1d1d", light: "#f2dede" },
  "inputValidation.errorBorder": { dark: "#be1100", light: "#be1100" },
  "list.activeSelectionBackground": { dark: "#04395e", light: "#0060c0" },
  "list.activeSelectionForeground": { dark: "#ffffff", light: "#ffffff" },
  "list.focusOutline": { dark: "#007fd4", light: "#0090f1" },
  "list.hoverBackground": { dark: "#2a2d2e", light: "#e8e8e8" },
  "list.inactiveSelectionBackground": { dark: "#37373d", light: "#e4e6f1" },
  "testing.iconFailed": { dark: "#f14c4c", light: "#f14c4c" },
  "testing.iconPassed": { dark: "#73c991", light: "#73c991" },
  "testing.iconQueued": { dark: "#cca700", light: "#cca700" },
  "toolbar.hoverBackground": { dark: "#5a5d5e50", light: "#b8b8b850" },
  "charts.purple": { dark: "#b180d7", light: "#652d90" },
};

/** Variables the sources read with a fallback, which VS Code doesn't define. */
const undefinedByVSCode = new Set([
  "textBlockQuote-foreground",
  "list-inactiveSelectionForeground",
]);

/** The variables that aren't colors. */
const fonts = {
  "font-family":
    'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  "font-size": "13px",
  "font-weight": "normal",
  "editor-font-family": 'Menlo, Monaco, "Courier New", monospace',
  "editor-font-size": "12px",
};

/** A theme file's colors, with those of the files it includes under them. */
function colorsOf(dir, file) {
  const text = fs
    .readFileSync(path.join(dir, file), "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,(\s*[}\]])/g, "$1");
  const theme = JSON.parse(text);
  const included = theme.include
    ? colorsOf(dir, path.basename(theme.include))
    : {};
  return { ...included, ...theme.colors };
}

/** The `--vscode-*` names the extension's webviews read. */
function usedVariables(srcDir) {
  const used = new Set();
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.name.endsWith(".ts"))
        for (const [, name] of fs
          .readFileSync(full, "utf8")
          .matchAll(/--vscode-([a-zA-Z0-9-]+)/g))
          used.add(name);
    }
  };
  visit(srcDir);
  return used;
}

/**
 * The CSS for `:root` in the theme: every variable the webviews read.
 * `codiumDir` is VSCodium's install, `extensionDir` the extension's folder.
 */
export function themeCss(kind, codiumDir, extensionDir) {
  const themes = path.join(
    codiumDir,
    "resources/app/extensions/theme-defaults/themes"
  );
  const colors = colorsOf(themes, themeFiles[kind]);
  const contributed = Object.fromEntries(
    JSON.parse(
      fs.readFileSync(path.join(extensionDir, "package.json"), "utf8")
    ).contributes.colors.map((color) => [color.id, color.defaults[kind]])
  );
  const resolve = (id, seen = new Set()) => {
    if (seen.has(id)) return undefined;
    seen.add(id);
    const value = colors[id] ?? defaults[id]?.[kind] ?? contributed[id];
    // A contributed color names the color it defaults to.
    return value && !value.startsWith("#") && value !== "transparent"
      ? resolve(value, seen)
      : value;
  };
  const lines = [];
  const unknown = [];
  for (const name of [
    ...usedVariables(path.join(extensionDir, "src")),
  ].sort()) {
    if (name in fonts) continue;
    const value = resolve(name.replaceAll("-", "."));
    if (value) lines.push(`--vscode-${name}: ${value};`);
    else unknown.push(name);
  }
  const unresolved = unknown.filter((name) => !undefinedByVSCode.has(name));
  if (unresolved.length)
    throw new Error(
      `No ${kind} value for --vscode-${unresolved.join(", --vscode-")}: add it to defaults in themes.mjs`
    );
  for (const [name, value] of Object.entries(fonts))
    lines.push(`--vscode-${name}: ${value};`);
  return `:root { ${lines.join(" ")} }`;
}
