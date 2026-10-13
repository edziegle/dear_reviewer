// Runs inside VS Code. Opens the fixture Change, then asks the language server
// for go-to-definition on each side of the diff and checks where it lands.

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function definitionOf(file, line, character) {
  const uri = vscode.Uri.file(file);
  await vscode.workspace.openTextDocument(uri);
  for (let attempt = 0; attempt < 60; attempt++) {
    const found = await vscode.commands.executeCommand(
      'vscode.executeDefinitionProvider',
      uri,
      new vscode.Position(line, character),
    );
    if (found && found.length) {
      return found.map((d) => (d.targetUri ?? d.uri).fsPath);
    }
    await sleep(1000);
  }
  return [];
}

function diffTabs() {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .map((tab) => ({ label: tab.label, kind: tab.input?.constructor?.name }));
}

async function run() {
  const repo = process.env.SPIKE_REPO;
  const change = await vscode.commands.executeCommand('dearReviewerSpike.openChange', {
    repo,
    base: 'HEAD~1',
    head: 'HEAD',
  });

  // Line 3 of main.py is `print(old_helper())` / `print(new_helper())`; column 8 is inside the name.
  const baseHits = await definitionOf(path.join(change.baseDir, 'main.py'), 2, 8);
  const headHits = await definitionOf(path.join(change.headDir, 'main.py'), 2, 8);

  const result = {
    workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
    tabs: diffTabs(),
    base: { expected: path.join(change.baseDir, 'util.py'), got: baseHits },
    head: { expected: path.join(change.headDir, 'util.py'), got: headHits },
  };
  result.base.ok = baseHits.includes(result.base.expected);
  result.head.ok = headHits.includes(result.head.expected);

  fs.writeFileSync(process.env.SPIKE_RESULT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));

  await vscode.commands.executeCommand('dearReviewerSpike.closeChange');
  if (!result.base.ok || !result.head.ok) {
    throw new Error('Navigation did not land in the matching worktree on both sides');
  }
}

module.exports = { run };
