// Runs the suites inside VSCodium with isolated user data and extensions, on
// macOS in the background (see backgroundCodium.ts). `mise run test` sets
// CODIUM_DIR to the folder of the VSCodium that mise.toml pins; without it,
// the suites run in /Applications/VSCodium.app, or /usr/share/codium on Linux.
// DEAR_REVIEWER_SUITES, DEAR_REVIEWER_FILES and DEAR_REVIEWER_GREP pick what
// runs; see AGENTS.md.

import * as cp from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runTests } from "@vscode/test-electron";
import { startFakeGitHub } from "./fakeGitHub";
import { acquireRunLock } from "./runLock";
import {
  codiumInstall,
  Launch,
  planLaunches,
  suiteOf,
  testWindowPids,
} from "./runPlan";

const root = path.resolve(__dirname, "..", "..");
const codium = codiumInstall(process.platform, process.env.CODIUM_DIR);
const testRoot = path.join(root, ".vscode-test");
const extensionsDir = path.join(testRoot, "extensions");
// VSCodium puts its IPC socket in the user data folder, and macOS caps a
// socket's path at 103 characters, so the folder lives under a short path
// named for this checkout rather than in it: its real path, since the
// extension sees the real paths of the files it keeps there. The link in
// testRoot keeps its logs where CI collects them.
const userDataDir = path.join(
  fs.realpathSync(os.tmpdir()),
  `dr-test-${crypto.createHash("sha256").update(fs.realpathSync(root)).digest("hex").slice(0, 8)}`
);
const userDataLink = path.join(testRoot, "user-data");
const work = path.join(testRoot, "work");
const fakeClaudeDir = path.join(work, "fake-claude");
const fakeClaude = path.join(fakeClaudeDir, "bin", "claude");
const backgroundCodium = path.join(testRoot, "background-codium");
const codiumOutput = path.join(testRoot, "codium-output");
const suiteResult = path.join(codiumOutput, "result");
// One run at a time on this machine: see docs/adr/0028-one-test-run-at-a-time.md.
const runLock = path.join(os.tmpdir(), "dear-reviewer-test-run.lock");

/**
 * Only the basedpyright suite needs these, so a failed install stops a CI run
 * but only warns locally, where the developer may be offline.
 */
function installLanguageServers() {
  // basedpyright refuses to activate without the Python extension.
  for (const extension of ["ms-python.python", "detachhead.basedpyright"]) {
    const install = cp.spawnSync(
      codium.cli,
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
    if (install.status === 0) continue;
    const failure = `Installing ${extension} failed (${install.error?.message ?? `exit code ${install.status}`})`;
    if (process.env.CI) throw new Error(failure);
    console.warn(`${failure}; continuing without it.`);
  }
}

function linkUserData() {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(testRoot, { recursive: true });
  fs.rmSync(userDataLink, { recursive: true, force: true });
  fs.symlinkSync(userDataDir, userDataLink);
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

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * Gives the executable runTests launches. On macOS it puts a wrapper on disk
 * that runs test/backgroundCodium.ts with this node, so VSCodium opens without
 * focus; Linux, which runs the tests on CI only, launches VSCodium itself.
 */
function codiumExecutable(): string {
  fs.rmSync(codiumOutput, { recursive: true, force: true });
  fs.mkdirSync(codiumOutput, { recursive: true });
  if (!codium.app) return codium.executable;
  fs.writeFileSync(
    backgroundCodium,
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(path.join(__dirname, "backgroundCodium.js"))} ${quote(codium.app)} ${quote(codiumOutput)} "$@"\n`,
    { mode: 0o755 }
  );
  return backgroundCodium;
}

/**
 * Puts the fake `claude` on disk: a wrapper that runs test/fakeClaude.ts with
 * this node, so the tests never reach a real Claude Code.
 */
function installFakeClaude() {
  fs.mkdirSync(path.dirname(fakeClaude), { recursive: true });
  fs.writeFileSync(
    fakeClaude,
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(path.join(__dirname, "fakeClaude.js"))} ${quote(fakeClaudeDir)} "$@"\n`,
    { mode: 0o755 }
  );
}

function writeUserSettings() {
  // The built-in git extension floods the log when it can't find git;
  // Dear Reviewer runs git itself.
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

/** A workspace that later phases of a suite reopen, made on first use. */
function sharedWorkspace(name: string): () => string {
  let file: string | undefined;
  return () => (file ??= multiRootWorkspace(name, name));
}

const changeFiles = sharedWorkspace("change-files");
const assistant = sharedWorkspace("assistant");
const review = sharedWorkspace("review");
const lifecycle = sharedWorkspace("lifecycle");
const localReview = sharedWorkspace("local-review");
const readingOrder = sharedWorkspace("reading-order");
const dashboard = sharedWorkspace("dashboard");

/**
 * Every launch of a run, in order, with what it opens. A phase like
 * `name/phase` is a later launch of suite `name`, sharing its fixtures folder;
 * an `afterReload` phase reopens the workspace, like a window reload.
 */
const phases: [phase: string, open: () => string][] = [
  ["multiRoot", () => multiRootWorkspace()],
  ["singleFolder", () => folder("single-folder")],
  ["inbox", () => folder("inbox")],
  ["changeFiles", changeFiles],
  ["changeFiles/afterReload", changeFiles],
  ["assistant", assistant],
  ["assistant/afterReload", assistant],
  ["pullRequest", () => multiRootWorkspace("pull-request", "pull-request")],
  ["review", review],
  ["review/afterReload", review],
  ["timeline", () => multiRootWorkspace("timeline", "timeline")],
  ["threads", () => multiRootWorkspace("threads", "threads")],
  [
    "localBranches",
    () => multiRootWorkspace("local-branches", "local-branches"),
  ],
  ["lifecycle", lifecycle],
  ["lifecycle/afterReload", lifecycle],
  [
    "sinceLastReview",
    () => multiRootWorkspace("since-last-review", "since-last-review"),
  ],
  ["localReview", localReview],
  ["localReview/afterReload", localReview],
  ["findings", () => multiRootWorkspace("findings", "findings")],
  ["codeFlow", () => multiRootWorkspace("code-flow", "code-flow")],
  ["readingOrder", readingOrder],
  ["readingOrder/afterReload", readingOrder],
  ["dashboard", dashboard],
  ["dashboard/afterReload", dashboard],
  // Last, so the repositories it remembers can't reach other suites; it forgets them when done.
  ["openFolders", () => multiRootWorkspace("open-folders", "open-folders")],
  ["openFolders/elsewhere", () => multiRootWorkspace("elsewhere", "elsewhere")],
];

const listed = (value: string | undefined) =>
  value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

/** The launches DEAR_REVIEWER_SUITES and DEAR_REVIEWER_FILES pick. */
function plannedLaunches(): Launch[] {
  const launches = planLaunches(
    phases.map(([phase]) => phase),
    {
      suites: listed(process.env.DEAR_REVIEWER_SUITES),
      files: listed(process.env.DEAR_REVIEWER_FILES),
    }
  );
  for (const { phase, files } of launches)
    for (const file of files ?? []) {
      const compiled = path.join(__dirname, "suite", phase, `${file}.test.js`);
      if (!fs.existsSync(compiled))
        throw new Error(
          `There is no test file test/suite/${phase}/${file}.test.ts`
        );
    }
  return launches;
}

/**
 * Stops every VSCodium process running with this checkout's test user data:
 * the window of an interrupted or failed run, never another checkout's or the
 * developer's own.
 */
async function killTestWindows() {
  const running = () =>
    testWindowPids(
      cp.execFileSync("ps", ["-A", "-o", "pid=,args="], { encoding: "utf8" }),
      userDataDir
    );
  const signal = (pids: number[], name: NodeJS.Signals) => {
    for (const pid of pids) {
      try {
        process.kill(pid, name);
      } catch {
        // It quit meanwhile.
      }
    }
  };
  let pids = running();
  if (pids.length === 0) return;
  console.log(`Closing ${pids.length} leftover test VSCodium processes.`);
  signal(pids, "SIGTERM");
  for (let i = 0; i < 50 && pids.length > 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    pids = running();
  }
  signal(pids, "SIGKILL");
}

let fakeGitHubUrl = "";
let executable = "";

/** The full titles of the tests that failed, from the suite's result file. */
function failedTests(): string[] {
  try {
    const [, ...titles] = fs.readFileSync(suiteResult, "utf8").split("\n");
    return titles.filter(Boolean);
  } catch {
    return [];
  }
}

/** Runs one launch, and returns what failed in it, if anything. */
async function launch({ phase, files }: Launch): Promise<string[]> {
  const openPath = phases.find(([p]) => p === phase)![1]();
  console.log(`\n=== ${phase} suite, opening ${path.basename(openPath)} ===`);
  fs.rmSync(suiteResult, { force: true });
  try {
    await runTests({
      vscodeExecutablePath: executable,
      extensionDevelopmentPath: root,
      extensionTestsPath: path.join(__dirname, "suite", "index.js"),
      extensionTestsEnv: {
        DEAR_REVIEWER_SUITE: phase,
        DEAR_REVIEWER_TEST_FILES: files?.join(","),
        DEAR_REVIEWER_GREP: process.env.DEAR_REVIEWER_GREP,
        DEAR_REVIEWER_FIXTURES: path.join(work, "fixtures", suiteOf(phase)),
        DEAR_REVIEWER_FAKE_GITHUB: fakeGitHubUrl,
        DEAR_REVIEWER_FAKE_CLAUDE: fakeClaude,
        DEAR_REVIEWER_FAKE_CLAUDE_DIR: fakeClaudeDir,
        DEAR_REVIEWER_RESULT: suiteResult,
      },
      // --force-disable-user-env keeps the launching PATH instead of
      // re-resolving it from the login shell.
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
    return [];
  } catch (err) {
    const tests = failedTests();
    return tests.length > 0 ? tests : [(err as Error).message];
  } finally {
    await killTestWindows();
  }
}

/** Closes the test window and frees the lock when the run is interrupted. */
function onInterrupt(cleanUp: () => Promise<void>) {
  const codes: Partial<Record<NodeJS.Signals, number>> = {
    SIGINT: 130,
    SIGTERM: 143,
    SIGHUP: 129,
  };
  for (const [signal, code] of Object.entries(codes)) {
    process.once(signal, () => {
      console.error(`\nInterrupted by ${signal}; closing the test window.`);
      cleanUp().finally(() => process.exit(code));
    });
  }
}

async function main() {
  const launches = plannedLaunches();
  const release = await acquireRunLock(
    runLock,
    `the test run in ${root}`,
    (holder) => console.log(`Waiting for ${holder} to finish.`)
  );
  let closeFakeGitHub = async () => {};
  let interrupted = false;
  onInterrupt(async () => {
    interrupted = true;
    await killTestWindows();
    await closeFakeGitHub();
    release();
  });
  const failures: [phase: string, tests: string[]][] = [];
  try {
    await killTestWindows();
    linkUserData();
    installLanguageServers();
    freshWorkFolder();
    executable = codiumExecutable();
    installFakeClaude();
    writeUserSettings();
    const fakeGitHub = await startFakeGitHub();
    closeFakeGitHub = () => fakeGitHub.close();
    fakeGitHubUrl = fakeGitHub.url;
    for (const planned of launches) {
      if (interrupted) break;
      const failed = await launch(planned);
      if (failed.length > 0) failures.push([planned.phase, failed]);
    }
  } finally {
    await closeFakeGitHub();
    release();
  }
  if (failures.length === 0) return;
  console.error(
    `\n=== ${failures.length} of ${launches.length} launches failed ===`
  );
  for (const [phase, tests] of failures) {
    console.error(`${phase}:`);
    for (const test of tests) console.error(`  ${test}`);
  }
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
