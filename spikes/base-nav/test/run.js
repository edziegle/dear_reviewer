// Runs the navigation check in test/suite.js inside the locally installed
// VSCodium, with a Python language server from Open VSX and a two-commit
// fixture repo. Override the install with CODIUM_APP=/path/to/VSCodium.app.

const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const { runTests } = require('@vscode/test-electron');

const root = path.resolve(__dirname, '..');
const codiumApp = process.env.CODIUM_APP ?? '/Applications/VSCodium.app';
const codiumExecutable = path.join(codiumApp, 'Contents', 'MacOS', 'VSCodium');
const codiumCli = path.join(codiumApp, 'Contents', 'Resources', 'app', 'bin', 'codium');
const work = path.join(root, '.vscode-test', 'work');
const repo = path.join(work, 'fixture-repo');
const extensionsDir = path.join(root, '.vscode-test', 'extensions');
const userDataDir = path.join(root, '.vscode-test', 'user-data');

function git(...args) {
  cp.execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
}

function write(file, text) {
  fs.writeFileSync(path.join(repo, file), text);
}

function buildFixture() {
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(repo, { recursive: true });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'spike@example.com');
  git('config', 'user.name', 'spike');
  write('util.py', 'def old_helper():\n    return 1\n');
  write('main.py', 'from util import old_helper\n\nprint(old_helper())\n');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  write('util.py', 'def new_helper():\n    return 2\n');
  write('main.py', 'from util import new_helper\n\nprint(new_helper())\n');
  git('commit', '-qam', 'rename helper');

  // Start multi-root so adding the worktree folders doesn't restart the extension host.
  const workspaceFile = path.join(work, 'spike.code-workspace');
  fs.writeFileSync(workspaceFile, JSON.stringify({ folders: [{ path: repo }] }, null, 2));
  return workspaceFile;
}

async function main() {
  const workspaceFile = buildFixture();
  // basedpyright refuses to activate without the Python extension.
  for (const extension of ['ms-python.python', 'detachhead.basedpyright']) {
    cp.spawnSync(
      codiumCli,
      ['--extensions-dir', extensionsDir, '--user-data-dir', userDataDir, '--install-extension', extension],
      { stdio: 'inherit' },
    );
  }

  await runTests({
    vscodeExecutablePath: codiumExecutable,
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(__dirname, 'suite.js'),
    extensionTestsEnv: { SPIKE_REPO: repo, SPIKE_RESULT: path.join(work, 'result.json') },
    // Keep the launching PATH instead of re-resolving it from the login shell.
    launchArgs: [workspaceFile, '--extensions-dir', extensionsDir, '--user-data-dir', userDataDir, '--force-disable-user-env'],
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
