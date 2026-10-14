import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  Change,
  ChangeRequest,
  ChangeWorkspace,
  changeTitle,
  fetchPullRequest,
} from "./changeWorkspace";
import {
  ChangeFilesNode,
  ChangeFilesView,
  emptyFileScheme,
} from "./changeFiles";
import { Assistants } from "./assistant/assistant";
import { Conversations } from "./assistant/conversations";
import { selectionInChange } from "./assistant/selection";
import { GitHubAuth } from "./github/auth";
import { GitHubClient, PullRequestSummary } from "./github/client";
import { Avatars, InboxNode, InboxTree, setContext } from "./inbox";
import { Repositories } from "./repositories";
import { ReviewWindow } from "./reviewWindow";
import { PendingReviews } from "./pendingReview";
import { ReviewComments, Verdict } from "./reviewComments";
import type { FromWebview } from "./timeline/panel";
import { LinkOpener, Timelines } from "./timeline/timelines";
import {
  GitHubViewedFiles,
  LocalViewedFiles,
  ViewedFilesBySource,
} from "./viewedFiles";

export function activate(context: vscode.ExtensionContext) {
  const changes = new ChangeWorkspace(context.globalStorageUri.fsPath);
  const settings = () => vscode.workspace.getConfiguration("dearReviewer");
  const auth = new GitHubAuth(context.secrets);
  // Only the user's own setting counts: a workspace must not be able to
  // send the Reviewer's token somewhere else.
  const apiUrl = () =>
    settings().inspect<string>("githubApiUrl")?.globalValue ||
    "https://api.github.com";
  const github = new GitHubClient(auth, apiUrl);
  // For the setup walkthrough's checklist.
  const showSignedIn = async () =>
    setContext("dearReviewer.signedIn", !!(await auth.token(apiUrl())));
  const viewedFiles = new ViewedFilesBySource(
    new LocalViewedFiles(context.globalStorageUri.fsPath),
    new GitHubViewedFiles(github)
  );
  const changeFiles = new ChangeFilesView(
    () => changes.list(),
    viewedFiles,
    path.join(context.globalStorageUri.fsPath, "change-files-view.json")
  );
  const review = new ReviewComments(
    () => changes.list(),
    new PendingReviews(github)
  );
  const changeFilesTree = vscode.window.createTreeView(
    "dearReviewer.changeFiles",
    {
      treeDataProvider: changeFiles,
      canSelectMany: true,
      manageCheckboxStateManually: true,
    }
  );
  // Only the user's own setting counts: a Change's worktrees, or any other
  // workspace, must not be able to choose the program Dear Reviewer runs.
  const assistants = new Assistants(
    () =>
      expandHome(settings().inspect<string>("claudePath")?.globalValue ?? ""),
    new Conversations(context.globalStorageUri.fsPath)
  );
  // Only the user's own setting counts: a workspace must not be able to
  // choose the repository Dear Reviewer runs git in.
  const localClones = () => {
    const clones =
      settings().inspect<Record<string, string>>("localClones")?.globalValue;
    return Object.fromEntries(
      Object.entries(clones ?? {}).map(([repo, clone]) => [
        repo,
        expandHome(clone),
      ])
    );
  };
  // A workspace may choose which repositories are listed, never where git runs.
  const repositories = new Repositories(
    context.globalStorageUri.fsPath,
    () => settings().get<string[]>("repositories") ?? [],
    { apiUrl, localClones }
  );
  const avatars = new Avatars(
    github,
    path.join(context.globalStorageUri.fsPath, "avatars")
  );
  const inbox = new InboxTree(
    github,
    () => repositories.inboxRepositories(),
    () => repositories.inboxClones(),
    avatars
  );
  // Links leave VS Code through the extension; the tests catch them instead.
  const openExternal: LinkOpener = (uri) => vscode.env.openExternal(uri);
  let openLink = openExternal;
  const timelines = new Timelines(github, avatars, (uri) => openLink(uri));

  /**
   * Remembers the folder as the repository's clone: the one given (by a
   * test), or one the Reviewer picks. Gives the clone, if one was taken.
   */
  async function locateClone(
    repository?: string,
    folder?: string
  ): Promise<string | undefined> {
    repository ??= await vscode.window.showInputBox({
      title: "Locate Clone",
      prompt: "The GitHub repository, as owner/name",
      ignoreFocusOut: true,
    });
    if (!repository) return;
    const chosen =
      folder ??
      (
        await vscode.window.showOpenDialog({
          title: `Locate the clone of ${repository}`,
          canSelectFolders: true,
          canSelectFiles: false,
          openLabel: "Use This Clone",
        })
      )?.[0]?.fsPath;
    if (!chosen) return;
    const result = await repositories.rememberClone(repository, chosen);
    if ("clone" in result) return result.clone;
    const again = "Choose Another Folder…";
    const answer = vscode.window.showErrorMessage(result.problem, again);
    // A folder given by the caller gets no second try.
    if (folder !== undefined) return;
    return (await answer) === again ? locateClone(repository) : undefined;
  }

  /** Adds the GitHub repository of a folder to the Inbox, remembering the folder as its clone. */
  async function addRepository(folder?: string): Promise<string | undefined> {
    const chosen = folder ?? (await pickRepositoryFolder());
    if (!chosen) return;
    const result = await repositories.rememberFolder(chosen);
    if ("repository" in result) {
      void vscode.window.showInformationMessage(
        `Added ${result.repository} to the Inbox, with its clone at ${chosen}.`
      );
      return result.repository;
    }
    const again = "Choose Another Folder…";
    const answer = vscode.window.showErrorMessage(result.problem, again);
    if (folder !== undefined) return;
    return (await answer) === again ? addRepository() : undefined;
  }

  async function pickRepositoryFolder(): Promise<string | undefined> {
    const browse = "Browse…";
    const folders = (vscode.workspace.workspaceFolders ?? []).filter(
      (f) =>
        f.uri.scheme === "file" &&
        !f.uri.fsPath.startsWith(context.globalStorageUri.fsPath + path.sep)
    );
    if (folders.length > 0) {
      const picked = await vscode.window.showQuickPick<vscode.QuickPickItem>(
        [
          ...folders.map((f) => ({ label: f.name, description: f.uri.fsPath })),
          { label: browse },
        ],
        { title: "Add Repository: a clone of a GitHub repository" }
      );
      if (!picked) return;
      if (picked.label !== browse) return picked.description;
    }
    return (
      await vscode.window.showOpenDialog({
        title: "Add Repository: a clone of a GitHub repository",
        canSelectFolders: true,
        canSelectFiles: false,
        openLabel: "Add to Inbox",
      })
    )?.[0]?.fsPath;
  }

  async function forgetRepository(repository?: string): Promise<void> {
    if (!repository) {
      const remembered = repositories.remembered();
      if (remembered.length === 0) {
        void vscode.window.showInformationMessage(
          "Dear Reviewer hasn't remembered any repositories. Those in the Repositories setting are removed there."
        );
        return;
      }
      const picked = await vscode.window.showQuickPick(
        remembered.map((r) => ({
          label: r.repository,
          description: r.clone,
          detail: repositories.isOpenHere(r.repository)
            ? "Open in this window, so it is remembered again when the window's folders change."
            : undefined,
        })),
        { title: "Forget Repository" }
      );
      repository = picked?.label;
      if (!repository) return;
    }
    repositories.forget(repository);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dearReviewer.openChange",
      async (request?: ChangeRequest) => {
        request ??= await askForChange(context.globalStorageUri.fsPath);
        if (!request) return;
        try {
          await changes.open(request);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(
            `Couldn't open the Change: ${message}`
          );
        }
        changeFiles.refresh();
      }
    ),
    vscode.commands.registerCommand(
      "dearReviewer.openPullRequest",
      async (target?: InboxNode | PullRequestSummary) => {
        const pr =
          target && "kind" in target
            ? target.kind === "pullRequest"
              ? target.pullRequest
              : undefined
            : target;
        if (!pr) return;
        const open = async (clone: string) => {
          try {
            await changes.open(await fetchPullRequest(clone, pr));
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const locate = "Locate Another Clone…";
            const picked = await vscode.window.showErrorMessage(
              `Couldn't open ${pr.repository} #${pr.number} from ${clone}: ${message}`,
              locate
            );
            const other =
              picked === locate && (await locateClone(pr.repository));
            if (other) return open(other);
          }
          changeFiles.refresh();
        };
        const clone = await repositories.cloneOf(pr.repository);
        if (clone) return open(clone);
        // Asking waits on the Reviewer, so the command doesn't.
        void askForLocalClone(pr.repository).then(async (picked) => {
          if (picked) await open(picked);
        });
      }
    ),
    vscode.commands.registerCommand(
      "dearReviewer.openLocalBranch",
      async (node?: InboxNode) => {
        if (node?.kind !== "localBranch") return;
        const { branch } = node;
        try {
          await changes.open({
            repository: branch.clone,
            base: branch.main,
            head: `refs/heads/${branch.name}`,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(
            `Couldn't open ${branch.name}: ${message}`
          );
        }
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
        timelines.close(closed);
        review.forget(closed);
        await viewedFiles.forget(closed);
        changeFiles.refresh();
      }
    ),
    // The timeline opens first, so the Assistant's summary is the side
    // panel the Reviewer sees, with the timeline a tab away.
    timelines,
    changes.onDidShowChange((change) => void timelines.open(change)),
    assistants,
    changes.onDidShowChange((change) => void assistants.open(change)),
    review,
    changes.onDidShowChange(() => void review.sync()),
    vscode.commands.registerCommand(
      "dearReviewer.addComment",
      (reply: vscode.CommentReply) => review.addComment(reply)
    ),
    vscode.commands.registerCommand(
      "dearReviewer.editComment",
      (comment: vscode.Comment) => review.editComment(comment)
    ),
    vscode.commands.registerCommand(
      "dearReviewer.saveComment",
      (comment: vscode.Comment) => review.saveComment(comment)
    ),
    vscode.commands.registerCommand(
      "dearReviewer.cancelEditComment",
      (comment: vscode.Comment) => review.cancelEdit(comment)
    ),
    vscode.commands.registerCommand(
      "dearReviewer.deleteComment",
      (comment: vscode.Comment) => review.deleteComment(comment)
    ),
    vscode.commands.registerCommand(
      "dearReviewer.submitReview",
      async (request?: ChangeRequest, verdict?: Verdict, summary?: string) => {
        request ??= await pickOpenChange(
          changes.list().filter((c) => c.pullRequest),
          "Submit Review"
        );
        const change = request && (await changes.find(request));
        if (!change?.pullRequest) {
          if (request)
            void vscode.window.showErrorMessage(
              "Only a pull request's Change is submitted as a Review."
            );
          return;
        }
        const { repository, number } = change.pullRequest;
        verdict ??= await pickVerdict(
          `Submit Review: ${repository} #${number}`
        );
        if (!verdict) return;
        summary ??= await vscode.window.showInputBox({
          title: `Submit Review: ${repository} #${number}`,
          prompt: "Summary",
          ignoreFocusOut: true,
        });
        if (summary === undefined) return;
        if (await review.submit(change, verdict, summary)) {
          void timelines.refresh(change);
          void vscode.window.showInformationMessage(
            `Submitted your Review of ${repository} #${number}.`
          );
        }
      }
    ),
    vscode.commands.registerCommand(
      "dearReviewer.showAssistant",
      async (request?: ChangeRequest) => {
        request ??= await pickOpenChange(changes.list(), "Show Assistant");
        const change = request && (await changes.find(request));
        if (change) await assistants.open(change);
      }
    ),
    vscode.commands.registerCommand(
      "dearReviewer.showTimeline",
      async (request?: ChangeRequest) => {
        request ??= await pickOpenChange(
          changes.list().filter((c) => c.pullRequest),
          "Show Timeline"
        );
        const change = request && (await changes.find(request));
        if (change) await timelines.open(change);
      }
    ),
    vscode.commands.registerCommand(
      "dearReviewer.sendSelectionToAssistant",
      async () => {
        const editor = vscode.window.activeTextEditor;
        const found = editor && selectionInChange(editor, changes.shownHere());
        if (!found) {
          void vscode.window.showInformationMessage(
            "Select code in the base or head of a Change open in this window to send it to the Assistant."
          );
          return;
        }
        await assistants.addSelection(found.change, found.selection);
      }
    ),
    vscode.commands.registerCommand(
      "dearReviewer.checkClaudeLogin",
      async () => {
        const login = await assistants.checkLogin();
        await setContext("dearReviewer.claudeSignedIn", !!login?.signedIn);
        return login;
      }
    ),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void repositories.scanWindow();
      changeFiles.refresh();
      void review.sync();
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
    vscode.commands.registerCommand("dearReviewer.refreshChangeFiles", () =>
      changeFiles.refresh()
    ),
    vscode.commands.registerCommand("dearReviewer.hideViewedFiles", () =>
      changeFiles.setHideViewed(true)
    ),
    vscode.commands.registerCommand("dearReviewer.showViewedFiles", () =>
      changeFiles.setHideViewed(false)
    ),
    vscode.window.registerTreeDataProvider("dearReviewer.inbox", inbox),
    vscode.commands.registerCommand(
      "dearReviewer.addRepository",
      (folder?: string) => addRepository(folder)
    ),
    vscode.commands.registerCommand(
      "dearReviewer.locateClone",
      (repository?: string, folder?: string) => locateClone(repository, folder)
    ),
    vscode.commands.registerCommand(
      "dearReviewer.forgetRepository",
      (repository?: string) => forgetRepository(repository)
    ),
    vscode.commands.registerCommand("dearReviewer.openSetup", () =>
      vscode.commands.executeCommand(
        "workbench.action.openWalkthrough",
        `${context.extension.id}#setup`,
        false
      )
    ),
    repositories.onDidChange(() => inbox.refresh()),
    vscode.workspace.onDidGrantWorkspaceTrust(() => repositories.scanWindow()),
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
    auth.onDidChange(() => {
      void showSignedIn();
      void review.sync();
      void timelines.refreshAll();
      return inbox.refresh();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("dearReviewer.githubApiUrl")) {
        // Which remotes are on GitHub depends on the API's host.
        void repositories.scanWindow();
        void showSignedIn();
        void review.sync();
        void timelines.refreshAll();
      }
      if (
        e.affectsConfiguration("dearReviewer.repositories") ||
        e.affectsConfiguration("dearReviewer.githubApiUrl") ||
        e.affectsConfiguration("dearReviewer.localClones")
      )
        void inbox.refresh();
    })
  );
  void repositories.scanWindow();
  void showSignedIn();
  void changes.showPendingDiffs();
  void review.sync();
  const reviewWindow = new ReviewWindow(context.globalStorageUri.fsPath);
  if (reviewWindow.isThisWindow() && !vscode.workspace.isTrusted)
    void askToTrustReviewWindow(context.globalStorageUri.fsPath);
  // After a reload, the Changes still in this window get their Assistant back.
  for (const change of changes.shownHere()) void assistants.open(change);
  // The views are how the Reviewer sees the Inbox, a Change's files, the
  // Assistant and their Comments; tests read them the same way.
  return {
    inbox,
    changeFiles,
    review: {
      controller: review.controller,
      threads: () => review.threads(),
    },
    assistant: {
      panels: () => assistants.panels(),
      loginStatus: () => assistants.loginStatus(),
    },
    timeline: {
      panels: () =>
        timelines.panels().map((panel) => ({
          title: panel.title,
          sent: panel.sent,
          rendered: panel.rendered,
          receive: (message: FromWebview) => panel.receive(message),
        })),
      /** Hands the links the Reviewer opens to `open` instead, or back to the browser. */
      openLinksWith: (open?: (url: string) => void) => {
        openLink = open
          ? async (uri) => {
              open(uri.toString(true));
              return true;
            }
          : openExternal;
      },
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

/** Offers to find the repository's clone, and gives the clone the Reviewer picked. */
async function askForLocalClone(
  repository: string
): Promise<string | undefined> {
  const locate = "Locate Clone\u2026";
  const openSettings = "Open Settings";
  const picked = await vscode.window.showWarningMessage(
    `Dear Reviewer doesn't know where ${repository} is cloned on this machine. Locate its clone, or open it in a VSCodium window, and Dear Reviewer will remember it.`,
    locate,
    openSettings
  );
  if (picked === locate)
    return vscode.commands.executeCommand<string | undefined>(
      "dearReviewer.locateClone",
      repository
    );
  if (picked === openSettings)
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "dearReviewer.localClones"
    );
}

/**
 * The review window's folders, Changes' worktrees, live in the extension's
 * storage, which VS Code doesn't trust until the Reviewer says so. Until then
 * language servers, and with them navigation, stay off (see ADR 0010).
 */
async function askToTrustReviewWindow(storageDir: string): Promise<void> {
  const trust = "Manage Workspace Trust";
  const picked = await vscode.window.showWarningMessage(
    `The review window is in Restricted Mode, so language servers and code navigation are off in its Changes. To turn them on, trust Dear Reviewer's folder of Changes once: ${storageDir}. Trusting it also lets the reviewed code's workspace settings and tasks apply in this window; Dear Reviewer itself only reads your user settings.`,
    trust
  );
  if (picked !== trust) return;
  await vscode.env.clipboard.writeText(storageDir);
  void vscode.window.showInformationMessage(
    "Copied the folder's path. In Workspace Trust, choose Add Folder and paste it."
  );
  await vscode.commands.executeCommand("workbench.trust.manage");
}

async function pickVerdict(title: string): Promise<Verdict | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      {
        label: "Comment",
        detail: "Submit general feedback without explicit approval.",
        verdict: "comment" as const,
      },
      {
        label: "Approve",
        detail: "Submit feedback and approve merging these changes.",
        verdict: "approve" as const,
      },
      {
        label: "Request Changes",
        detail: "Submit feedback that must be addressed before merging.",
        verdict: "requestChanges" as const,
      },
    ],
    { title, ignoreFocusOut: true }
  );
  return picked?.verdict;
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
    pullRequest: picked.change.pullRequest,
  };
}

/** Settings are typed by hand, so accept `~/dev/repo` as well as absolute paths. */
function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/")
    ? path.join(os.homedir(), p.slice(1))
    : p;
}
