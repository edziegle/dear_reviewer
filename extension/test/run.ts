// Runs the suites inside the locally installed VSCodium with isolated user
// data and extensions. Override the install with CODIUM_APP=/path/to/VSCodium.app.

import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import { runTests } from "@vscode/test-electron";
import { startFakeGitHub } from "./fakeGitHub";

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
const fakeClaudeDir = path.join(work, "fake-claude");
const fakeClaude = path.join(fakeClaudeDir, "bin", "claude");

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

/**
 * Puts the fake `claude` on disk: a wrapper that runs test/fakeClaude.ts with
 * this node, so the tests never reach a real Claude Code.
 */
function installFakeClaude() {
  fs.mkdirSync(path.dirname(fakeClaude), { recursive: true });
  const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  fs.writeFileSync(
    fakeClaude,
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(path.join(__dirname, "fakeClaude.js"))} ${quote(fakeClaudeDir)} "$@"\n`,
    { mode: 0o755 }
  );
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
      {
        "git.enabled": false,
        "window.restoreWindows": "none",
        // Every suite opens Changes, and each one starts the Assistant.
        "dearReviewer.claudePath": fakeClaude,
      },
      null,
      2
    )
  );
}

function multiRootWorkspace(
  name = "reviewer",
  firstFolder = "multi-root"
): string {
  const folder = path.join(work, firstFolder);
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(work, `${name}.code-workspace`);
  fs.writeFileSync(file, JSON.stringify({ folders: [{ path: folder }] }));
  return file;
}

function folder(name: string): string {
  const folder = path.join(work, name);
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

let fakeGitHubUrl = "";

/**
 * Runs the suite unless DEAR_REVIEWER_SUITES names others (comma-separated).
 * A suite like `name/phase` is a later launch of suite `name`, sharing its
 * fixtures folder.
 */
async function runSuite(suite: string, openPath: string) {
  const name = suite.split("/")[0];
  const only = process.env.DEAR_REVIEWER_SUITES?.split(",");
  if (only && !only.includes(name)) return;
  console.log(`\n=== ${suite} suite, opening ${path.basename(openPath)} ===`);
  await runTests({
    vscodeExecutablePath: codiumExecutable,
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(__dirname, "suite", "index.js"),
    extensionTestsEnv: {
      DEAR_REVIEWER_SUITE: suite,
      DEAR_REVIEWER_FIXTURES: path.join(work, "fixtures", name),
      DEAR_REVIEWER_FAKE_GITHUB: fakeGitHubUrl,
      DEAR_REVIEWER_FAKE_CLAUDE: fakeClaude,
      DEAR_REVIEWER_FAKE_CLAUDE_DIR: fakeClaudeDir,
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
      // Keeps test tokens out of the OS keychain.
      "--use-inmemory-secretstorage",
    ],
  });
}

async function main() {
  installLanguageServers();
  freshWorkFolder();
  installFakeClaude();
  writeUserSettings();
  const fakeGitHub = await startFakeGitHub();
  fakeGitHubUrl = fakeGitHub.url;
  try {
    await runSuite("multiRoot", multiRootWorkspace());
    await runSuite("singleFolder", folder("single-folder"));
    await runSuite("inbox", folder("inbox"));
    // The second launch reopens the same workspace, like a window reload.
    const changeFiles = multiRootWorkspace("change-files", "change-files");
    await runSuite("changeFiles", changeFiles);
    await runSuite("changeFiles/afterReload", changeFiles);
    await runSuite("assistant", multiRootWorkspace("assistant", "assistant"));
    await runSuite(
      "pullRequest",
      multiRootWorkspace("pull-request", "pull-request")
    );
    const review = multiRootWorkspace("review", "review");
    await runSuite("review", review);
    await runSuite("review/afterReload", review);
    await runSuite("timeline", multiRootWorkspace("timeline", "timeline"));
    await runSuite(
      "localBranches",
      multiRootWorkspace("local-branches", "local-branches")
    );
  } finally {
    await fakeGitHub.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
