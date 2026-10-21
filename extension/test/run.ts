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
  failureLines,
  groupLaunches,
  GroupPlan,
  LaunchGroup,
  Outcome,
  outcomes,
  planLaunches,
  Progress,
  testWindowPids,
  unlaunchedPhases,
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
const suiteProgress = path.join(codiumOutput, "progress.json");
// One run at a time on this machine: see docs/adr/0028-one-test-run-at-a-time.md.
const runLock = path.join(os.tmpdir(), "dear-reviewer-test-run.lock");
// Only DEAR_REVIEWER_SUITES=screenshots runs the screenshots suite: it opens a
// visible window and writes images here, which no test run should do.
const screenshotsRequested = process.env.DEAR_REVIEWER_SUITES?.split(",")
  .map((s) => s.trim())
  .includes("screenshots");
const screenshotsDir = path.resolve(
  process.env.DEAR_REVIEWER_SCREENSHOTS ??
    path.join(root, "..", "docs", "images", "screenshots")
);

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
        ...(screenshotsRequested && {
          "workbench.startupEditor": "none",
          "workbench.tips.enabled": false,
          "workbench.welcomePage.walkthroughs.openOnInstall": false,
          "workbench.editor.empty.hint": "hidden",
          "editor.minimap.enabled": false,
          "editor.fontSize": 14,
          "extensions.autoUpdate": false,
          "update.mode": "none",
          "telemetry.telemetryLevel": "off",
          "security.workspace.trust.enabled": false,
          "window.commandCenter": false,
          "window.title": "Dear Reviewer",
          "breadcrumbs.enabled": false,
        }),
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

/**
 * The review window's workspace, holding only its home folder, as Dear
 * Reviewer writes it in its storage (src/reviewWindow.ts) before any Change
 * opens there.
 */
function reviewWindowWorkspace(): string {
  const storage = path.join(
    userDataDir,
    "User",
    "globalStorage",
    "edziegle.dear-reviewer"
  );
  const home = path.join(storage, "changes");
  fs.mkdirSync(path.join(home, ".vscode"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".vscode", "settings.json"),
    JSON.stringify({ "files.exclude": { "*": true, ".*": true } })
  );
  const file = path.join(
    storage,
    "review-window",
    "Dear Reviewer.code-workspace"
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      folders: [{ path: home, name: "Dear Reviewer" }],
      settings: {
        "terminal.integrated.enablePersistentSessions": false,
        "terminal.integrated.hideOnStartup": "always",
      },
    })
  );
  return file;
}

/** The workspace the reload suites share, in the launch before the reload and the one after. */
let reloadWorkspaceFile: string | undefined;
function reloadWorkspace(): string {
  return (reloadWorkspaceFile ??= multiRootWorkspace("reload", "reload"));
}

/** Every launch of a run, in order, and what it opens (ADR 0039). */
const launchGroups: (GroupPlan & {
  open: () => string;
  /** Whether it opens the review window, and runs its phases there. */
  inReviewWindow?: true;
})[] = [
  {
    name: "single folder",
    phases: ["singleFolder"],
    open: () => folder("single-folder"),
  },
  // Before the suites that leave pull request Changes open in the user data, which a later window would poll.
  { name: "inbox", phases: ["inbox"], open: () => folder("inbox") },
  // First in the window: a suite that signs in makes the extension learn the Reviewer's name, which a local Change's Comments don't have.
  {
    name: "local review",
    phases: ["localReview"],
    open: reloadWorkspace,
  },
  {
    name: "local review reloaded, then dashboard and change files",
    phases: ["localReview/afterReload", "dashboard", "changeFiles"],
    open: reloadWorkspace,
  },
  {
    name: "change files reloaded, then assistant",
    phases: ["changeFiles/afterReload", "dashboard/afterReload", "assistant"],
    open: reloadWorkspace,
  },
  {
    name: "assistant reloaded, then review",
    phases: ["assistant/afterReload", "review"],
    open: reloadWorkspace,
  },
  {
    name: "review reloaded, then reading order and repetition",
    phases: ["review/afterReload", "readingOrder", "repetition"],
    open: reloadWorkspace,
  },
  {
    // It deletes Dear Reviewer's storage, so it comes after the suites that keep Changes in it.
    name: "lifecycle",
    phases: ["lifecycle"],
    open: reloadWorkspace,
  },
  {
    name: "lifecycle reloaded, then the multi-root suites",
    phases: [
      "lifecycle/afterReload",
      "multiRoot",
      "pullRequest",
      "timeline",
      "threads",
      "localBranches",
      "sinceLastReview",
      "findings",
      "agentNote",
      "codeFlow",
    ],
    open: reloadWorkspace,
  },
  // Last, so the repositories it remembers can't reach other suites; it forgets them when done.
  {
    name: "open folders",
    phases: ["openFolders"],
    open: () => multiRootWorkspace("open-folders", "open-folders"),
  },
  {
    name: "open folders, elsewhere",
    phases: ["openFolders/elsewhere"],
    open: () => multiRootWorkspace("elsewhere", "elsewhere"),
  },
  // Opt-in, after the rest: see screenshotsRequested. The Dashboard shows
  // only in the Reviewer's own window, and a review only in the review window.
  {
    name: "screenshots",
    phases: ["screenshots"],
    open: () => folder("screenshots"),
  },
  {
    name: "screenshots, in the review window",
    phases: ["screenshots/reviewWindow"],
    open: reviewWindowWorkspace,
    inReviewWindow: true,
  },
];

const listed = (value: string | undefined) =>
  value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

/** The phases that have test files: the folders under test/suite, as `name` or `name/phase`. */
function phasesWithTests(folder = path.join(__dirname, "suite")): string[] {
  const phases: string[] = [];
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(folder, entry.name);
    const nested = phasesWithTests(dir).map((p) => `${entry.name}/${p}`);
    const hasTests = fs.readdirSync(dir).some((f) => f.endsWith(".test.js"));
    if (hasTests) phases.push(entry.name);
    phases.push(...nested);
  }
  return phases;
}

/** The launches DEAR_REVIEWER_SUITES and DEAR_REVIEWER_FILES pick. */
function plannedLaunches(): LaunchGroup<(typeof launchGroups)[number]>[] {
  const unlaunched = unlaunchedPhases(phasesWithTests(), launchGroups);
  if (unlaunched.length > 0)
    throw new Error(
      `No launch group holds ${unlaunched.join(", ")}: add it to launchGroups`
    );
  const groups = launchGroups.filter(
    (g) =>
      screenshotsRequested ||
      !g.phases.some((p) => p.split("/")[0] === "screenshots")
  );
  const launches = groupLaunches(
    planLaunches(
      groups.flatMap((g) => g.phases),
      {
        suites: listed(process.env.DEAR_REVIEWER_SUITES),
        files: listed(process.env.DEAR_REVIEWER_FILES),
      }
    ),
    groups
  );
  for (const { phases } of launches)
    for (const { phase, files } of phases)
      for (const file of files ?? []) {
        const compiled = path.join(
          __dirname,
          "suite",
          phase,
          `${file}.test.js`
        );
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

/** What the launch's suites did before it ended, from the progress file. */
function readProgress(): Progress | undefined {
  try {
    return JSON.parse(fs.readFileSync(suiteProgress, "utf8")) as Progress;
  } catch {
    return undefined;
  }
}

/**
 * Runs one launch, and gives how each of its phases ended. A phase the
 * launch never finished fails, and nothing reruns it.
 */
async function launch({
  name,
  phases,
  open,
  inReviewWindow,
}: LaunchGroup<(typeof launchGroups)[number]>): Promise<Outcome[]> {
  const openPath = open();
  console.log(
    `\n=== ${name}: ${phases.map((p) => p.phase).join(", ")}, opening ${path.basename(openPath)} ===`
  );
  fs.rmSync(suiteResult, { force: true });
  fs.rmSync(suiteProgress, { force: true });
  let crash: string | undefined;
  try {
    await runTests({
      vscodeExecutablePath: executable,
      extensionDevelopmentPath: root,
      extensionTestsPath: path.join(__dirname, "suite", "index.js"),
      extensionTestsEnv: {
        // The git of a test, and of the extension under test, reads none of the machine's config.
        GIT_CONFIG_GLOBAL: os.devNull,
        GIT_CONFIG_SYSTEM: os.devNull,
        DEAR_REVIEWER_PLAN: JSON.stringify(phases),
        DEAR_REVIEWER_GREP: process.env.DEAR_REVIEWER_GREP,
        DEAR_REVIEWER_FIXTURES_ROOT: path.join(work, "fixtures"),
        DEAR_REVIEWER_FAKE_GITHUB: fakeGitHubUrl,
        DEAR_REVIEWER_FAKE_CLAUDE: fakeClaude,
        DEAR_REVIEWER_FAKE_CLAUDE_DIR: fakeClaudeDir,
        DEAR_REVIEWER_RESULT: suiteResult,
        DEAR_REVIEWER_PROGRESS: suiteProgress,
        DEAR_REVIEWER_USER_DATA: userDataDir,
        DEAR_REVIEWER_TESTS_IN_REVIEW_WINDOW: inReviewWindow ? "1" : undefined,
        // A saved workspace takes Changes' folders as the review window does,
        // which tests can't run in; a single folder sends them on.
        DEAR_REVIEWER_HOLD_CHANGES_HERE:
          !inReviewWindow && openPath.endsWith(".code-workspace")
            ? "1"
            : undefined,
        DEAR_REVIEWER_SCREENSHOTS: screenshotsRequested
          ? screenshotsDir
          : undefined,
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
        // Chromium's shared memory lives in /dev/shm, which a container caps at
        // 64 MB; when it fills, a webview's renderer dies and never says ready.
        "--disable-dev-shm-usage",
        // Keeps test tokens out of the OS keychain.
        "--use-inmemory-secretstorage",
      ],
    });
  } catch (err) {
    crash = (err as Error).message;
  } finally {
    await killTestWindows();
  }
  const results: Outcome[] = outcomes(
    phases.map((p) => p.phase),
    readProgress()
  );
  if (crash && results.every((o) => o.status === "passed"))
    results.push({ launch: name, status: "failed", failed: [crash] });
  return results;
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
  const failures: Outcome[] = [];
  let launched = 0;
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
      launched++;
      failures.push(...(await launch(planned)));
    }
  } finally {
    await closeFakeGitHub();
    release();
  }
  console.log(`\n${launched} launches.`);
  const failed = failures.filter((o) => o.status !== "passed");
  if (failed.length === 0) return;
  console.error(
    `\n=== ${failed.length} of ${failures.length} suites failed, in ${launched} launches ===`
  );
  for (const line of failureLines(failures)) console.error(line);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
