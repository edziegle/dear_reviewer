// Spike: can both sides of a review diff get real code navigation?
// Each Change gets two detached worktrees (base and head). Both are added as
// workspace folders and the diff is opened between real file: URIs, so the
// language servers treat both sides as ordinary project files.

const vscode = require('vscode');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

const run = promisify(execFile);

async function git(cwd, ...args) {
  const { stdout } = await run('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim();
}

function changeDir(storageRoot, repo, base, head) {
  const id = crypto.createHash('sha256').update(`${repo}\0${base}\0${head}`).digest('hex').slice(0, 12);
  return path.join(storageRoot, 'changes', id);
}

async function openChange(context, { repo, base, head }) {
  const mergeBase = await git(repo, 'merge-base', base, head);
  const headSha = await git(repo, 'rev-parse', head);
  const dir = changeDir(context.globalStorageUri.fsPath, repo, mergeBase, headSha);
  const baseDir = path.join(dir, 'base');
  const headDir = path.join(dir, 'head');

  for (const [wt, rev] of [[baseDir, mergeBase], [headDir, headSha]]) {
    await git(repo, 'worktree', 'add', '--force', '--detach', wt, rev).catch((err) => {
      if (!/already exists/.test(String(err.stderr))) throw err;
    });
  }

  const folders = vscode.workspace.workspaceFolders ?? [];
  const wanted = [
    { uri: vscode.Uri.file(baseDir), name: `base ${mergeBase.slice(0, 7)}` },
    { uri: vscode.Uri.file(headDir), name: `head ${headSha.slice(0, 7)}` },
  ].filter((f) => !folders.some((existing) => existing.uri.fsPath === f.uri.fsPath));
  if (wanted.length) vscode.workspace.updateWorkspaceFolders(folders.length, 0, ...wanted);

  const nameStatus = await git(repo, 'diff', '--name-status', '--no-renames', mergeBase, headSha);
  const resources = nameStatus
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, file] = line.split('\t');
      const original = status === 'A' ? undefined : vscode.Uri.file(path.join(baseDir, file));
      const modified = status === 'D' ? undefined : vscode.Uri.file(path.join(headDir, file));
      return [vscode.Uri.file(path.join(headDir, file)), original, modified];
    });

  await vscode.commands.executeCommand('vscode.changes', `Change ${mergeBase.slice(0, 7)}..${headSha.slice(0, 7)}`, resources);
  return { baseDir, headDir, resources };
}

async function closeChange(context, { repo, baseDir, headDir }) {
  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const dir of [headDir, baseDir]) {
    const index = folders.findIndex((f) => f.uri.fsPath === dir);
    if (index >= 0) vscode.workspace.updateWorkspaceFolders(index, 1);
    await git(repo, 'worktree', 'remove', '--force', dir).catch(() => {});
  }
}

function activate(context) {
  let current;

  context.subscriptions.push(
    vscode.commands.registerCommand('dearReviewerSpike.openChange', async (args) => {
      if (!args) {
        const repo = (await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Repository' }))?.[0]?.fsPath;
        if (!repo) return;
        const base = await vscode.window.showInputBox({ prompt: 'Base ref', value: 'main' });
        if (!base) return;
        const head = await vscode.window.showInputBox({ prompt: 'Head ref', value: 'HEAD' });
        if (!head) return;
        args = { repo, base, head };
      }
      current = { repo: args.repo, ...(await openChange(context, args)) };
      return current;
    }),
    vscode.commands.registerCommand('dearReviewerSpike.closeChange', async () => {
      if (current) await closeChange(context, current);
      current = undefined;
    }),
  );
}

module.exports = { activate, deactivate() {} };
