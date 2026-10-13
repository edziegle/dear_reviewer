import * as path from "path";
import * as vscode from "vscode";
import {
  Change,
  ChangeRequest,
  ChangeWorkspace,
  changeTitle,
} from "./changeWorkspace";

export function activate(context: vscode.ExtensionContext) {
  const changes = new ChangeWorkspace(context.globalStorageUri.fsPath);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dearReviewer.openChange",
      async (request?: ChangeRequest) => {
        request ??= await askForChange(context.globalStorageUri.fsPath);
        if (request) await changes.open(request);
      }
    ),
    vscode.commands.registerCommand(
      "dearReviewer.closeChange",
      async (request?: ChangeRequest) => {
        request ??= await pickOpenChange(changes.list());
        if (request) await changes.close(request);
      }
    ),
    vscode.workspace.onDidChangeWorkspaceFolders(() =>
      changes.showPendingDiffs()
    )
  );
  void changes.showPendingDiffs();
}

export function deactivate() {}

async function askForChange(
  storageDir: string
): Promise<ChangeRequest | undefined> {
  const repository = await pickRepository(storageDir);
  if (!repository) return;
  const base = await vscode.window.showInputBox({
    title: "Open Change",
    prompt: "Base: the branch, tag or commit the Change starts from",
    value: "main",
  });
  if (!base) return;
  const head = await vscode.window.showInputBox({
    title: "Open Change",
    prompt: "Head: the branch, tag or commit to review",
    value: "HEAD",
  });
  if (!head) return;
  return { repository, base, head };
}

async function pickRepository(storageDir: string): Promise<string | undefined> {
  const browse = "Browse…";
  // The Reviewer's own folders, not Change worktrees or the review window's home.
  const folders = (vscode.workspace.workspaceFolders ?? []).filter(
    (f) =>
      f.uri.scheme === "file" && !f.uri.fsPath.startsWith(storageDir + path.sep)
  );
  if (folders.length > 0) {
    const picked = await vscode.window.showQuickPick<vscode.QuickPickItem>(
      [
        ...folders.map((f) => ({ label: f.name, description: f.uri.fsPath })),
        { label: browse },
      ],
      { title: "Open Change: repository" }
    );
    if (!picked) return;
    if (picked.label !== browse) return picked.description;
  }
  const chosen = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    openLabel: "Review this repository",
  });
  return chosen?.[0]?.fsPath;
}

async function pickOpenChange(
  open: Change[]
): Promise<ChangeRequest | undefined> {
  if (open.length === 0) {
    void vscode.window.showInformationMessage("No Change is open.");
    return;
  }
  const picked = await vscode.window.showQuickPick(
    open.map((change) => ({
      label: changeTitle(change),
      description: change.repository,
      change,
    })),
    { title: "Close Change" }
  );
  if (!picked) return;
  return {
    repository: picked.change.repository,
    base: picked.change.mergeBase,
    head: picked.change.headSha,
  };
}
