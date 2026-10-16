// Runs test/suite.js inside the locally installed VSCodium against a fixture
// repo with the same call chain in TypeScript, Python (basedpyright from Open
// VSX) and Go (no language extension installed, as the negative case).
// Override the install with CODIUM_APP=/path/to/VSCodium.app.

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
// VSCodium's IPC socket lives here and macOS caps a socket path at 103 characters.
const userDataDir = path.join(fs.realpathSync(require('os').tmpdir()), 'dr-spike-ch');

function write(file, text) {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), text);
}

function buildFixture() {
  fs.rmSync(work, { recursive: true, force: true });
  // The same chain everywhere: entry -> submit -> (check, drain) -> leaf.
  write('ts/entry.ts', 'import { submit } from "./submit";\nexport function entry() {\n  return submit("approve");\n}\n');
  write('ts/submit.ts', 'import { check, drain } from "./steps";\nexport function submit(verdict: string) {\n  check(verdict);\n  return drain();\n}\n');
  write('ts/steps.ts', 'export function check(v: string) {\n  return v === "approve";\n}\nexport function drain() {\n  return leaf();\n}\nfunction leaf() {\n  return 1;\n}\n');
  write('py/entry.py', 'from submit import submit\n\n\ndef entry():\n    return submit("approve")\n');
  write('py/submit.py', 'from steps import check, drain\n\n\ndef submit(verdict):\n    check(verdict)\n    return drain()\n');
  write('py/steps.py', 'def check(v):\n    return v == "approve"\n\n\ndef drain():\n    return leaf()\n\n\ndef leaf():\n    return 1\n');
  write('go/submit.go', 'package main\n\nfunc submit(v string) int {\n\tcheck(v)\n\treturn drain()\n}\n\nfunc check(v string) bool { return v == "approve" }\n\nfunc drain() int { return 1 }\n');
  write('tsconfig.json', '{ "compilerOptions": { "strict": true, "target": "es2020", "module": "commonjs" } }\n');
  const workspaceFile = path.join(work, 'spike.code-workspace');
  fs.writeFileSync(workspaceFile, JSON.stringify({ folders: [{ path: repo }] }, null, 2));
  return workspaceFile;
}

async function main() {
  const workspaceFile = buildFixture();
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
    launchArgs: [workspaceFile, '--extensions-dir', extensionsDir, '--user-data-dir', userDataDir, '--force-disable-user-env'],
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
