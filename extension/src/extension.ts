import * as path from "path";
import * as vscode from "vscode";
import {
  Change,
  ChangeRequest,
  ChangeWorkspace,
  changeTitle,
} from "./changeWorkspace";
import {
  ChangeFilesNode,
  ChangeFilesView,
  emptyFileScheme,
} from "./changeFiles";
import { Assistants } from "./assistant/assistant";
import { GitHubAuth } from "./github/auth";
import { GitHubClient } from "./github/client";
import { Avatars, InboxTree } from "./inbox";
import { LocalViewedFiles } from "./viewedFiles";

export function activate(context: vscode.ExtensionContext) {
  const changes = new ChangeWorkspace(context.globalStorageUri.fsPath);
  const viewedFiles = new LocalViewedFiles(context.globalStorageUri.fsPath);
  const changeFiles = new ChangeFilesView(
    () => changes.list(),
    viewedFiles,
    path.join(context.globalStorageUri.fsPath, "change-files-view.json")
  );
  const changeFilesTree = vscode.window.createTreeView(
    "dearReviewer.changeFiles",
    {
      treeDataProvider: changeFiles,
      canSelectMany: true,
      manageCheckboxStateManually: true,
    }
  );
  const settings = () => vscode.workspace.getConfiguration("dearReviewer");
  const auth = new GitHubAuth(context.secrets);
  // Only the user's own setting counts: a workspace must not be able to
  // send the Reviewer's token somewhere else.
  const apiUrl = () =>
    settings().inspect<string>("githubApiUrl")?.globalValue ||
    "https://api.github.com";
  const github = new GitHubClient(auth, apiUrl);
  // Only the user's own setting counts: a Change's worktrees, or any other
  // workspace, must not be able to choose the program Dear Reviewer runs.
  const assistants = new Assistants(
    () => settings().inspect<string>("claudePath")?.globalValue ?? ""
  );
  const inbox = new InboxTree(
    github,
    () => settings().get<string[]>("repositories") ?? [],
    new Avatars(github, path.join(context.globalStorageUri.fsPath, "avatars"))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dearReviewer.openChange",
      async (request?: ChangeRequest) => {
        request ??= await askForChange(context.globalStorageUri.fsPath);
        if (request) await changes.open(request);
        changeFiles.refresh();
      }
    ),
    vscode.commands.registerCommand(
      "dearReviewer.closeChange",
      async (request?: ChangeRequest) => {
        request ??= await pickOpenChange(changes.list(), "Close Change");
        if (!request) return;
        const closed = await changes.close(request);
        assistants.close(closed);
        await viewedFiles.forget(closed);
        changeFiles.refresh();
      }
    ),
    assistants,
    changes.onDidShowChange((change) => void assistants.open(change)),
    vscode.commands.registerCommand(
      "dearReviewer.showAssistant",
      async (request?: ChangeRequest) => {
        request ??= await pickOpenChange(changes.list(), "Show Assistant");
        const change = request && (await changes.find(request));
        if (change) await assistants.open(change);
      }
    ),
    vscode.commands.registerCommand("dearReviewer.checkClaudeLogin", () =>
      assistants.checkLogin()
    ),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      changeFiles.refresh();
      return changes.showPendingDiffs();
    }),
    changeFilesTree,
    changeFilesTree.onDidChangeCheckboxState(async (e) => {
      for (const [node, state] of e.items) {
        await changeFiles.setViewed(
          [node],
          state === vscode.TreeItemCheckboxState.Checked
        );
      }
    }),
    vscode.window.registerFileDecorationProvider(changeFiles),
    vscode.workspace.registerTextDocumentContentProvider(emptyFileScheme, {
      provideTextDocumentContent: () => "",
    }),
    vscode.commands.registerCommand(
      "dearReviewer.openChangeFile",
      (node: ChangeFilesNode) => changeFiles.openDiff(node)
    ),
    vscode.commands.registerCommand(
      "dearReviewer.markViewed",
      (node?: ChangeFilesNode, selected?: ChangeFilesNode[]) =>
        changeFiles.setViewed(
          selected ?? (node ? [node] : [...changeFilesTree.selection]),
          true
        )
    ),
    vscode.commands.registerCommand(
      "dearReviewer.unmarkViewed",
      (node?: ChangeFilesNode, selected?: ChangeFilesNode[]) =>
        changeFiles.setViewed(
          selected ?? (node ? [node] : [...changeFilesTree.selection]),
          false
        )
    ),
    vscode.commands.registerCommand("dearReviewer.hideViewedFiles", () =>
      changeFiles.setHideViewed(true)
    ),
    vscode.commands.registerCommand("dearReviewer.showViewedFiles", () =>
      changeFiles.setHideViewed(false)
    ),
    vscode.window.registerTreeDataProvider("dearReviewer.inbox", inbox),
    vscode.commands.registerCommand("dearReviewer.refreshInbox", () =>
      inbox.refresh()
    ),
    vscode.commands.registerCommand(
      "dearReviewer.setToken",
      async (token?: string) => {
        token ??= await vscode.window.showInputBox({
          title: "GitHub personal access token",
          prompt:
            "Used when VS Code's GitHub sign-in isn't available. Stored in the OS keychain.",
          password: true,
          ignoreFocusOut: true,
        });
        if (!token) return;
        try {
          await auth.setToken(apiUrl(), token);
        } catch (err) {
          void vscode.window.showErrorMessage(
            err instanceof Error ? err.message : String(err)
          );
        }
      }
    ),
    vscode.commands.registerCommand("dearReviewer.signIn", () => auth.signIn()),
    vscode.commands.registerCommand("dearReviewer.forgetToken", () =>
      auth.forgetToken(apiUrl())
    ),
    auth.onDidChange(() => inbox.refresh()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("dearReviewer.repositories") ||
        e.affectsConfiguration("dearReviewer.githubApiUrl")
      )
        void inbox.refresh();
    })
  );
  void changes.showPendingDiffs();
  // The views are how the Reviewer sees the Inbox, a Change's files and the
  // Assistant; tests read them the same way.
  return {
    inbox,
    changeFiles,
    assistant: {
      panels: () => assistants.panels(),
      loginStatus: () => assistants.loginStatus(),
    },
  };
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
  open: Change[],
  title: string
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
    { title }
  );
  if (!picked) return;
  return {
    repository: picked.change.repository,
    base: picked.change.mergeBase,
    head: picked.change.headSha,
  };
}
