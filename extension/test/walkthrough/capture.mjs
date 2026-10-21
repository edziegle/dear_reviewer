// Draws the walkthroughs' images (package.json, contributes.walkthroughs):
// each screen of `scenes.ts` is a real webview, run in headless Chromium with
// the theme's `--vscode-*` variables and the stylesheet VS Code gives every
// webview, in Default Dark Modern and Default Light Modern, at twice the
// pixel density so the walkthrough stays sharp on a high-density display.
// Run it with `mise run walkthrough-images`.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { themeCss } from "./themes.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(here, "../..");
const outDir = path.join(extensionDir, "media/walkthrough");
const scale = 2;

const codiumDir =
  process.env.CODIUM_DIR ??
  execFileSync("mise", ["where", "github:VSCodium/vscodium"], {
    encoding: "utf8",
  }).trim();

/**
 * The UI font, Inter, which is close to the system font VS Code uses on macOS
 * and doesn't depend on the machine's fonts, so the images look the same
 * wherever they are drawn.
 */
const inter = fs
  .readFileSync(
    path.join(
      extensionDir,
      "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"
    )
  )
  .toString("base64");
const interFace = `@font-face { font-family: "Inter"; font-weight: 100 900; src: url(data:font/woff2;base64,${inter}) format("woff2"); }`;

/** What VS Code puts in every webview before the page's own styles. */
const webviewDefaults = `
  html { background: var(--surface); }
  body {
    background-color: transparent;
    color: var(--vscode-editor-foreground);
    font-family: var(--vscode-font-family);
    font-weight: var(--vscode-font-weight);
    font-size: var(--vscode-font-size);
    margin: 0;
    padding: 0 20px;
  }
  img, video { max-width: 100%; max-height: 100%; }
  a, a code { color: var(--vscode-textLink-foreground); }
  a:hover { color: var(--vscode-textLink-activeForeground); }
  a:focus, input:focus, select:focus, textarea:focus {
    outline: 1px solid -webkit-focus-ring-color;
    outline-offset: -1px;
  }
  code {
    font-family: var(--vscode-editor-font-family);
    color: var(--vscode-textPreformat-foreground);
    background-color: var(--vscode-textPreformat-background);
    padding: 1px 3px;
    border-radius: 4px;
  }
  pre code { padding: 0; }
`;

const surfaces = {
  sideBar: "var(--vscode-sideBar-background)",
  editor: "var(--vscode-editor-background)",
};

/** The scenes, bundled with the stub standing in for `vscode`. */
async function loadScenes() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "walkthrough-"));
  const file = path.join(dir, "scenes.cjs");
  await build({
    entryPoints: [path.join(here, "scenes.ts")],
    bundle: true,
    outfile: file,
    platform: "node",
    format: "cjs",
    alias: { vscode: path.join(here, "vscodeStub.ts") },
    logLevel: "warning",
  });
  return createRequire(import.meta.url)(file).scenes;
}

async function capture(browser, scene, kind, css) {
  const context = await browser.newContext({
    viewport: { width: scene.width, height: scene.height },
    deviceScaleFactor: scale,
    colorScheme: kind,
    bypassCSP: true,
  });
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (error) => problems.push(error.message));
  const webview = scene.open();
  // The page says which state it rendered once it has drawn it.
  let drawn;
  const rendered = new Promise((resolve) => (drawn = resolve));
  await page.exposeFunction("__postToExtension", (message) => {
    if (message?.type === "rendered") drawn();
    webview.fromPage(message);
  });
  // `setContent` writes into the open page, so a global set before it stays.
  await page.evaluate(() => {
    let state;
    window.acquireVsCodeApi = () => ({
      postMessage: (message) => window.__postToExtension(message),
      getState: () => state,
      setState: (next) => (state = next),
    });
  });
  webview.toPage = (message) =>
    page.evaluate((data) => window.postMessage(data, "*"), message);
  await page.setContent(webview.html);
  // VS Code names the theme's kind on the body, which pages style by.
  await page.evaluate(
    (name) => document.body.classList.add(name),
    `vscode-${kind}`
  );
  await page.addStyleTag({
    content: `${interFace} ${css} :root { --surface: ${surfaces[scene.surface]}; } ${webviewDefaults}`,
  });
  // The page asks for its state when it loads.
  await Promise.race([
    rendered,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${scene.name} got no state`)), 10_000)
    ),
  ]);
  if (scene.click) await page.click(scene.click);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const file = path.join(outDir, `${scene.name}-${kind}.png`);
  await page.screenshot({ path: file, type: "png" });
  await context.close();
  if (problems.length)
    throw new Error(`${scene.name}-${kind}: ${problems.join("; ")}`);
  return file;
}

const scenes = await loadScenes();
const browser = await chromium.launch();
try {
  for (const kind of ["dark", "light"]) {
    const css = themeCss(kind, codiumDir, extensionDir);
    for (const scene of scenes)
      console.log(
        `wrote ${path.relative(extensionDir, await capture(browser, scene, kind, css))}`
      );
  }
} finally {
  await browser.close();
}
