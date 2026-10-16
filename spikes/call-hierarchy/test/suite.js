// Runs inside VS Code. For each language, asks the language server for the call
// hierarchy of `submit`: prepare, then outgoing and incoming calls, one hop.
// Writes what came back; it asserts nothing, since the question is "what do we get".

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const name = (item) => `${item.name} (${path.basename(item.uri.fsPath)}:${item.range.start.line + 1})`;

async function hierarchy(file, line, character) {
  const uri = vscode.Uri.file(file);
  const doc = await vscode.workspace.openTextDocument(uri);
  const started = Date.now();
  let items = [];
  // Language servers start lazily, so retry until the first answer or give up.
  for (let attempt = 0; attempt < 45; attempt++) {
    items = (await vscode.commands.executeCommand('vscode.prepareCallHierarchy', uri, new vscode.Position(line, character))) ?? [];
    if (items.length) break;
    await sleep(1000);
  }
  if (!items.length) return { language: doc.languageId, prepared: [], waitedMs: Date.now() - started };
  const outgoing = (await vscode.commands.executeCommand('vscode.provideOutgoingCalls', items[0])) ?? [];
  const incoming = (await vscode.commands.executeCommand('vscode.provideIncomingCalls', items[0])) ?? [];
  return {
    language: doc.languageId,
    prepared: items.map(name),
    outgoing: outgoing.map((c) => name(c.to)),
    incoming: incoming.map((c) => name(c.from)),
    waitedMs: Date.now() - started,
  };
}

async function run() {
  const repo = process.env.SPIKE_REPO;
  const result = {
    extensions: vscode.extensions.all.filter((e) => !e.packageJSON.isBuiltin).map((e) => e.id),
    typescript: await hierarchy(path.join(repo, 'ts/submit.ts'), 1, 20),
    python: await hierarchy(path.join(repo, 'py/submit.py'), 3, 5),
    go: await hierarchy(path.join(repo, 'go/submit.go'), 2, 7),
  };
  fs.writeFileSync(process.env.SPIKE_RESULT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { run };
