// Runs the suites inside the locally installed VSCodium with isolated user
// data and extensions. Override the install with CODIUM_APP=/path/to/VSCodium.app.

import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import { runTests } from "@vscode/test-electron";

const root = path.resolve(__dirname, "..", "..");
const codiumApp = process.env.CODIUM_APP ?? "/Applications/VSCodium.app";
const codiumExecutable = path.join(codiumApp, "Contents", "MacOS", "VSCodium");
const codiumCli = path.join(
  codiumApp,
  "Contents",
  "Resources",
  "app",
  "bin",
  "codium"
);
const testRoot = path.join(root, ".vscode-test");
const extensionsDir = path.join(testRoot, "extensions");
const userDataDir = path.join(testRoot, "user-data");
const work = path.join(testRoot, "work");

function installLanguageServers() {
  // basedpyright refuses to activate without the Python extension.
  for (const extension of ["ms-python.python", "detachhead.basedpyright"]) {
    cp.spawnSync(
      codiumCli,
      [
        "--extensions-dir",
        extensionsDir,
        "--user-data-dir",
        userDataDir,
        "--install-extension",
        extension,
      ],
      { stdio: "inherit" }
    );
  }
}

function freshWorkFolder() {
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(
    path.join(userDataDir, "User", "globalStorage", "edziegle.dear-reviewer"),
    {
      recursive: true,
      force: true,
    }
  );
  fs.mkdirSync(work, { recursive: true });
}

function writeUserSettings() {
  // The built-in git extension can't find git under the agent sandbox and
  // floods the log; Dear Reviewer runs git itself.
  const settings = path.join(userDataDir, "User", "settings.json");
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  // Each suite starts in the window it asks for, not the last one restored.
  fs.writeFileSync(
    settings,
    JSON.stringify(
      { "git.enabled": false, "window.restoreWindows": "none" },
      null,
      2
    )
  );
}

function multiRootWorkspace(): string {
  const folder = path.join(work, "multi-root");
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(work, "reviewer.code-workspace");
  fs.writeFileSync(file, JSON.stringify({ folders: [{ path: folder }] }));
  return file;
}

function singleFolder(): string {
  const folder = path.join(work, "single-folder");
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

async function runSuite(suite: string, openPath: string) {
  console.log(`\n=== ${suite} suite, opening ${path.basename(openPath)} ===`);
  await runTests({
    vscodeExecutablePath: codiumExecutable,
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(__dirname, "suite", "index.js"),
    extensionTestsEnv: {
      DEAR_REVIEWER_SUITE: suite,
      DEAR_REVIEWER_FIXTURES: path.join(work, "fixtures", suite),
    },
    // --force-disable-user-env keeps the launching PATH instead of
    // re-resolving it from the login shell, which the sandbox blocks.
    launchArgs: [
      openPath,
      "--extensions-dir",
      extensionsDir,
      "--user-data-dir",
      userDataDir,
      "--force-disable-user-env",
      // Software rendering avoids GPU surface failures that crash the window.
      "--disable-gpu",
    ],
  });
}

async function main() {
  installLanguageServers();
  freshWorkFolder();
  writeUserSettings();
  await runSuite("multiRoot", multiRootWorkspace());
  await runSuite("singleFolder", singleFolder());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
