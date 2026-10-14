import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  Change,
  ChangeRequest,
  ChangeWorkspace,
  changeName,
  changeTitle,
  fetchPullRequest,
  pullRequestName,
} from "./changeWorkspace";
import {
  ChangeFilesNode,
  ChangeFilesView,
  emptyFileScheme,
} from "./changeFiles";
import { Assistants } from "./assistant/assistant";
import { Briefs } from "./briefs";
import { Conversations } from "./assistant/conversations";
import { Findings, FindingsNode } from "./findings";
import { selectionInChange, whereInChange } from "./assistant/selection";
import { GitHubAuth } from "./github/auth";
import { GitHubClient, PullRequestSummary } from "./github/client";
import { setContext } from "./context";
import { Avatars, InboxNode, InboxTree } from "./inbox";
import { Lifecycle } from "./lifecycle";
import { LocalPendingReviews } from "./localReviews";
import { LocalClone, Repositories } from "./repositories";
import { ReviewWindow } from "./reviewWindow";
import { GitHubPendingReviews, PendingReviewsBySource } from "./pendingReview";
import { ReviewComments, Verdict } from "./reviewComments";
import {
  CommitFiles,
  commitFileScheme,
  Reviews,
  showChangesSince,
} from "./reviews";
import type { FromWebview } from "./timeline/panel";
import { LinkOpener, Timelines } from "./timeline/timelines";
import {
  GitHubViewedFiles,
  LocalViewedFiles,
  ViewedFilesBySource,
} from "./viewedFiles";
import { messageOf } from "./errors";

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
    path.join(context.globalStorageUri.fsPath, "change-files-view.json"),
    (change) => reviews.lastReviewed(change)
  );
  const avatars = new Avatars(
    github,
    path.join(context.globalStorageUri.fsPath, "avatars")
  );
  const githubReviews = new GitHubPendingReviews(github);
  const localReviews = new LocalPendingReviews(
    context.globalStorageUri.fsPath,
    () => githubReviews.viewer
  );
  const review = new ReviewComments(
    () => changes.list(),
    new PendingReviewsBySource(localReviews, githubReviews),
    avatars
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
  // Links leave VS Code through the extension; the tests catch them instead.
  const openExternal: LinkOpener = (uri) => vscode.env.openExternal(uri);
  let openLink = openExternal;
  const conversations = new Conversations(context.globalStorageUri.fsPath);
  const reviews = new Reviews(github, localReviews);
  const assistants = new Assistants(
    () =>
      expandHome(settings().inspect<string>("claudePath")?.globalValue ?? ""),
    conversations,
    (uri) => openLink(uri),
    (change) => reviews.lastReviewed(change)
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
  const inbox = new InboxTree(
    github,
    () => repositories.inboxRepositories(),
    () => repositories.inboxClones(),
    avatars,
    (conversation) => localReviews.lastBriefed(conversation),
    () => changes.list()
  );
  const briefs = new Briefs(
    context.globalStorageUri.fsPath,
    localReviews,
    (change, threads) => assistants.writeBrief(change, threads),
    async (conversation) => {
      for (const change of changes.list()) {
        if (change.conversation !== conversation) continue;
        await review.reload(change);
        changeFiles.reviewEnded(change);
      }
      // The Inbox shows which branches changed since a Brief.
      void inbox.refresh();
    }
  );
  const timelines = new Timelines(
    github,
    avatars,
    (uri) => openLink(uri),
    (change) =>
      void vscode.commands.executeCommand(
        "dearReviewer.submitReview",
        requestOf(change)
      )
  );
  const findings = new Findings(
    context.extensionUri,
    (change) => assistants.findIssues(change),
    (change, note) => assistants.addNote(change, note),
    (change, place) => review.onDiff(change, place),
    (change, place, body) => review.draft(change, place, body)
  );

  async function stepFinding(direction: 1 | -1): Promise<void> {
    if (!(await findings.step(direction)))
      void vscode.window.showInformationMessage(
        "There are no Findings. Ask for Findings on a Change to have the Assistant raise some."
      );
  }

  /** Lets go of a Change that was closed: its panels, Comments, Findings and viewed files. */
  async function letGo(change: Change): Promise<void> {
    assistants.close(change);
    timelines.close(change);
    review.forget(change);
    findings.forget(change);
    await viewedFiles.forget(change);
  }

  const lifecycle = new Lifecycle(
    changes,
    github,
    { conversations, localReviews, briefs },
    async (clone) =>
      (await repositories.inboxClones()).find(
        (c) => path.resolve(c.clone) === path.resolve(clone)
      )?.repository,
    async (change) => {
      await letGo(change);
      showOpenChanges();
    }
  );

  /**
   * Shows which Changes are open: in Change Files, in the Inbox, and to the
   * review keybindings, which work while one is open in this window.
   */
  function showOpenChanges(): void {
    changeFiles.refresh();
    inbox.redraw();
    void setContext(
      "dearReviewer.hasOpenChange",
      changes.shownHere().length > 0
    );
  }

  /**
   * The file of a Change open in this window that the active editor tab
   * shows, either side of a diff, or at the reviewed commit of what changed
   * since the last Review.
   */
  function activeFile(): ReturnType<typeof whereInChange> {
    const shown = changes.shownHere();
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    const uris =
      input instanceof vscode.TabInputTextDiff
        ? [input.modified, input.original]
        : input instanceof vscode.TabInputText
          ? [input.uri]
          : [];
    for (const uri of uris) {
      const where = whereInChange(uri, shown);
      if (where) return where;
    }
  }

  /** The Change open in this window of the panel or editor the Reviewer is looking at. */
  function activeChange(): Change | undefined {
    const panel = assistants.activeChangeId() ?? timelines.activeChangeId();
    if (panel) return changes.shownHere().find((c) => c.id === panel);
    return activeFile()?.change;
  }

  /**
   * The Change a command acts on: the one given, by a Change Files menu or
   * a test, or else the one the Reviewer is looking at, or else the only one
   * open in this window that fits, or else one they pick. `none` says why
   * there is none.
   */
  async function changeFor(
    target: ChangeTarget | undefined,
    title: string,
    fits: (change: Change) => boolean = () => true,
    none = "No Change is open in this window."
  ): Promise<Change | undefined> {
    if (target && "kind" in target)
      return target.kind === "change" ? target.change : undefined;
    if (target) {
      const change = await changes.find(target);
      if (!change)
        void vscode.window.showErrorMessage(
          "The Change isn't open in this window."
        );
      return change;
    }
    const looking = activeChange();
    if (looking && fits(looking)) return looking;
    return pickChange(changes.shownHere().filter(fits), title, none);
  }

  /** Moves to the next or previous file not yet viewed, first marking the one shown viewed if asked. */
  async function stepUnviewed(
    direction: 1 | -1,
    markShown: boolean
  ): Promise<void> {
    const where = activeFile();
    const here = where?.file.side === "commit" ? undefined : where;
    if (markShown && !here) {
      void vscode.window.showInformationMessage(
        "Open a file's diff from Change Files to mark it viewed."
      );
      return;
    }
    const change =
      here?.change ??
      (await changeFor(
        undefined,
        direction === 1 ? "Next Unviewed File" : "Previous Unviewed File"
      ));
    if (!change) return;
    if (here && markShown)
      await changeFiles.setFilesViewed(change, [here.file.path], true);
    const { file } = await changeFiles.unviewedFile(
      change,
      here?.file.path,
      direction
    );
    if (file) await changeFiles.openFile(change, file);
    else
      void vscode.window.showInformationMessage(
        `Every file of ${changeName(change)} is viewed.`
      );
  }

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
        request ??= await askForChange(
          context.globalStorageUri.fsPath,
          repositories.remembered()
        );
        if (!request) return;
        const { repository, base, head } = request;
        try {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Opening ${path.basename(repository)} ${base}..${head}…`,
            },
            () => changes.open(request)
          );
        } catch (err) {
          const message = messageOf(err);
          void vscode.window.showErrorMessage(
            `Couldn't open the Change: ${message}`
          );
        }
        showOpenChanges();
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
            await inbox.opened(
              { kind: "pullRequest", pullRequest: pr },
              `Opening ${pullRequestName(pr)}…`,
              async () => changes.open(await fetchPullRequest(clone, pr))
            );
          } catch (err) {
            const message = messageOf(err);
            const locate = "Locate Another Clone…";
            const picked = await vscode.window.showErrorMessage(
              `Couldn't open ${pr.repository} #${pr.number} from ${clone}: ${message}`,
              locate
            );
            const other =
              picked === locate && (await locateClone(pr.repository));
            if (other) return open(other);
          }
          showOpenChanges();
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
          await inbox.opened(node, `Opening ${branch.name}…`, () =>
            changes.open({
              repository: branch.clone,
              base: branch.main,
              head: `refs/heads/${branch.name}`,
            })
          );
        } catch (err) {
          const message = messageOf(err);
          void vscode.window.showErrorMessage(
            `Couldn't open ${branch.name}: ${message}`
          );
        }
        showOpenChanges();
      }
    ),
    vscode.commands.registerCommand(
      "dearReviewer.closeChange",
      async (target?: ChangeTarget) => {
        let request: ChangeRequest | undefined;
        if (target && "kind" in target)
          request =
            target.kind === "change" ? requestOf(target.change) : undefined;
        else if (target) request = target;
        else {
          // A Change open in another window can be closed from here too.
          const change =
            activeChange() ??
            (await pickChange(
              changes.list(),
              "Close Change",
              "No Change is open."
            ));
          request = change && requestOf(change);
        }
        if (!request) return;
        await letGo(await changes.close(request));
        showOpenChanges();
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
      "dearReviewer.replyToThread",
      (reply: vscode.CommentReply) => review.reply(reply)
    ),
    vscode.commands.registerCommand(
      "dearReviewer.resolveThread",
      (thread: vscode.CommentThread) => review.setResolved(thread, true)
    ),
    vscode.commands.registerCommand(
      "dearReviewer.unresolveThread",
      (thread: vscode.CommentThread) => review.setResolved(thread, false)
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
      async (
        target?: ChangeTarget,
        given?: unknown,
        givenSummary?: unknown
      ) => {
        const change = await changeFor(
          target,
          "Submit Review",
          (c) => !!c.pullRequest,
          "No pull request's Change is open in this window. A local Change's Review ends with a Brief."
        );
        if (!change) return;
        if (!change.pullRequest) {
          void vscode.window.showErrorMessage(
            "Only a pull request's Change is submitted as a Review. A local Change's Review ends with a Brief."
          );
          return;
        }
        // Menus of a tree that selects many pass the selection after the node.
        let verdict = isVerdict(given) ? given : undefined;
        let summary =
          typeof givenSummary === "string" ? givenSummary : undefined;
        await review.sync();
        const name = changeName(change);
        const comments = countOf(review.pendingCount(change), "Comment");
        verdict ??= await pickVerdict(name, comments);
        if (!verdict) return;
        const chosen = verdict;
        summary ??= await vscode.window.showInputBox({
          title: `Submit Review: ${name} · ${verdicts[chosen].label}`,
          prompt: `The summary GitHub shows with your verdict, published with ${comments}.`,
          placeHolder: "Summary for the author",
          ignoreFocusOut: true,
        });
        if (summary === undefined) return;
        const text = summary;
        const submitted = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Submitting your Review of ${name}…`,
          },
          () => review.submit(change, chosen, text)
        );
        if (!submitted) return;
        void timelines.refresh(change);
        changeFiles.reviewEnded(change);
        // The Inbox shows which pull requests changed since a Review.
        void inbox.refresh();
        void vscode.window.showInformationMessage(
          comments === "no Comments"
            ? `${verdicts[chosen].done} ${name}.`
            : `${verdicts[chosen].done} ${name} and published ${comments}.`
        );
      }
    ),
    vscode.commands.registerCommand(
      "dearReviewer.discardReview",
      async (target?: ChangeTarget, confirmed?: unknown) => {
        const change = await changeFor(target, "Discard Pending Review");
        if (!change) return;
        await review.sync();
        const name = changeName(change);
        const count = review.pendingCount(change);
        if (count === 0) {
          void vscode.window.showInformationMessage(
            `Your Review of ${name} has no pending Comments to discard.`
          );
          return;
        }
        const comments = countOf(count, "Comment");
        const discard = "Discard Review";
        if (confirmed !== true) {
          const picked = await vscode.window.showWarningMessage(
            `Discard your Review of ${name}? Its ${comments} will be deleted without being published. This can't be undone.`,
            { modal: true },
            discard
          );
          if (picked !== discard) return;
        }
        if (await review.discard(change)) {
          changeFiles.refresh();
          void vscode.window.showInformationMessage(
            `Discarded your Review of ${name} and its ${comments}.`
          );
        }
      }
    ),
    vscode.commands.registerCommand(
      "dearReviewer.writeBrief",
      async (target?: ChangeTarget) => {
        const change = await changeFor(
          target,
          "Write Brief",
          (c) => !c.pullRequest,
          "No local Change is open in this window. A pull request's Review ends when you submit it."
        );
        if (!change) return;
        if (change.pullRequest) {
          void vscode.window.showErrorMessage(
            "A pull request's Review ends when you submit it; a Brief ends a local Change's Review."
          );
          return;
        }
        await briefs.write(change);
      }
    ),
    vscode.commands.registerCommand(
      "dearReviewer.finishReview",
      async (target?: ChangeTarget) => {
        const change = await changeFor(target, "Finish Review");
        if (!change) return;
        await vscode.commands.executeCommand(
          change.pullRequest
            ? "dearReviewer.submitReview"
            : "dearReviewer.writeBrief",
          requestOf(change)
        );
      }
    ),
    vscode.commands.registerCommand(
      "dearReviewer.copyBrief",
      (uri?: vscode.Uri) => briefs.copy(uri)
    ),
    findings,
    vscode.window.registerTreeDataProvider("dearReviewer.findings", findings),
    vscode.commands.registerCommand(
      "dearReviewer.findIssues",
      async (target?: ChangeTarget) => {
        const change = await changeFor(target, "Ask for Findings");
        if (change) await findings.find(change);
      }
    ),
    vscode.commands.registerCommand(
      "dearReviewer.dismissFinding",
      (target?: string | FindingsNode) => {
        const finding = findings.get(target);
        if (finding) findings.dismiss(finding);
        else showNoFinding();
      }
    ),
    vscode.commands.registerCommand(
      "dearReviewer.convertFinding",
      async (target?: string | FindingsNode) => {
        const finding = findings.get(target);
        if (finding) await findings.convert(finding);
        else showNoFinding();
      }
    ),
    vscode.commands.registerCommand("dearReviewer.nextFinding", () =>
      stepFinding(1)
    ),
    vscode.commands.registerCommand("dearReviewer.previousFinding", () =>
      stepFinding(-1)
    ),
    vscode.commands.registerCommand("dearReviewer.nextUnviewedFile", () =>
      stepUnviewed(1, false)
    ),
    vscode.commands.registerCommand("dearReviewer.previousUnviewedFile", () =>
      stepUnviewed(-1, false)
    ),
    vscode.commands.registerCommand("dearReviewer.markViewedAndNext", () =>
      stepUnviewed(1, true)
    ),
    vscode.commands.registerCommand(
      "dearReviewer.revealFinding",
      async (target?: string | FindingsNode) => {
        const finding = findings.get(target);
        if (finding) await findings.reveal(finding);
      }
    ),
    vscode.commands.registerCommand(
      "dearReviewer.showChangesSinceLastReview",
      async (target?: ChangeTarget) => {
        const change = await changeFor(
          target,
          "Show Changes Since My Last Review"
        );
        if (!change) return;
        const name = changeName(change);
        let from: string | undefined;
        try {
          from = await reviews.lastReviewed(change);
        } catch (err) {
          const message = messageOf(err);
          void vscode.window.showErrorMessage(
            `Couldn't find your last Review of ${name}: ${message}`
          );
          return;
        }
        if (!from) {
          void vscode.window.showInformationMessage(
            change.pullRequest
              ? `You haven't submitted a Review of ${name} yet, so all of it is new to you.`
              : `You haven't written a Brief for ${name} yet, so all of it is new to you.`
          );
          return;
        }
        if (from === change.headSha) {
          void vscode.window.showInformationMessage(
            `${name} has no new commits since your last Review, at ${from.slice(0, 7)}.`
          );
          return;
        }
        await showChangesSince(change, from);
      }
    ),
    vscode.commands.registerCommand(
      "dearReviewer.showAssistant",
      async (target?: ChangeTarget) => {
        const change = await changeFor(target, "Show Assistant");
        if (change) await assistants.open(change);
      }
    ),
    vscode.commands.registerCommand(
      "dearReviewer.showTimeline",
      async (target?: ChangeTarget) => {
        const change = await changeFor(
          target,
          "Show Timeline",
          (c) => !!c.pullRequest,
          "No pull request's Change is open in this window. A local Change has no timeline."
        );
        if (!change) return;
        if (!change.pullRequest) {
          void vscode.window.showErrorMessage(
            "A local Change has no timeline."
          );
          return;
        }
        await timelines.open(change);
      }
    ),
    vscode.commands.registerCommand(
      "dearReviewer.sendSelectionToAssistant",
      async () => {
        const editor = vscode.window.activeTextEditor;
        const found = editor && selectionInChange(editor, changes.shownHere());
        if (!found) {
          void vscode.window.showInformationMessage(
            "Select code in the base or head of a Change open in this window, or in what changed since your last Review, to send it to the Assistant."
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
      showOpenChanges();
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
    vscode.workspace.registerTextDocumentContentProvider(
      commitFileScheme,
      new CommitFiles(() => changes.list().map((c) => c.repository))
    ),
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
    // Refreshing is also when merged and closed pull requests' Changes go.
    vscode.commands.registerCommand("dearReviewer.refreshInbox", () =>
      Promise.all([inbox.refresh(), lifecycle.tidy()])
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
          void vscode.window.showErrorMessage(messageOf(err));
        }
      }
    ),
    vscode.commands.registerCommand("dearReviewer.signIn", () => auth.signIn()),
    vscode.commands.registerCommand("dearReviewer.forgetToken", () =>
      auth.forgetToken(apiUrl())
    ),
    auth.onDidChange(() => {
      void showSignedIn();
      void lifecycle.tidy();
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
  showOpenChanges();
  void lifecycle.tidy();
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
    findings: {
      view: findings,
      decorated: () => findings.decorated(),
    },
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
    },
    /** Hands the links the Reviewer opens, from any panel, to `open` instead, or back to the browser. */
    openLinksWith: (open?: (url: string) => void) => {
      openLink = open
        ? async (uri) => {
            open(uri.toString(true));
            return true;
          }
        : openExternal;
    },
  };
}

export function deactivate() {}

async function askForChange(
  storageDir: string,
  remembered: LocalClone[]
): Promise<ChangeRequest | undefined> {
  const repository = await pickRepository(storageDir, remembered);
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

/**
 * Asks for the repository of a local Change: one of the window's own folders,
 * a clone remembered from the Reviewer's windows, which is all the review
 * window can offer, or a folder to browse for.
 */
async function pickRepository(
  storageDir: string,
  remembered: LocalClone[]
): Promise<string | undefined> {
  const browse = "Browse…";
  // The Reviewer's own folders, not Change worktrees or the review window's home.
  const folders = (vscode.workspace.workspaceFolders ?? []).filter(
    (f) =>
      f.uri.scheme === "file" && !f.uri.fsPath.startsWith(storageDir + path.sep)
  );
  const choices = folders.map((f) => ({
    label: f.name,
    description: f.uri.fsPath,
  }));
  for (const { repository, clone } of remembered) {
    const offered = choices.some(
      (c) => path.resolve(c.description) === path.resolve(clone)
    );
    if (!offered && fs.existsSync(clone))
      choices.push({ label: repository, description: clone });
  }
  if (choices.length > 0) {
    const picked = await vscode.window.showQuickPick<vscode.QuickPickItem>(
      [...choices, { label: browse }],
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
    `Dear Reviewer doesn't know where ${repository} is cloned on this machine. Locate its clone, or open it as a folder in a window, and Dear Reviewer will remember it.`,
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

function showNoFinding(): void {
  void vscode.window.showInformationMessage(
    "Put the cursor on a Finding's lines, or pick one in the Findings view."
  );
}

/** A Change a command is given: by a test or another command, or by a Change Files menu. */
type ChangeTarget = ChangeRequest | ChangeFilesNode;

/** The request that opens this Change. */
function requestOf(change: Change): ChangeRequest {
  return {
    repository: change.repository,
    base: change.mergeBase,
    head: change.headSha,
    pullRequest: change.pullRequest,
  };
}

/** Such as "no Comments", "1 Comment" or "3 Comments". */
function countOf(count: number, noun: string): string {
  if (count === 0) return `no ${noun}s`;
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

const verdicts: Record<
  Verdict,
  { label: string; detail: string; done: string }
> = {
  comment: {
    label: "Feedback Only",
    detail:
      "Publish your summary and Comments without approving or requesting changes.",
    done: "Sent feedback on",
  },
  approve: {
    label: "Approve",
    detail:
      "Publish your summary and Comments, and approve merging these changes.",
    done: "Approved",
  },
  requestChanges: {
    label: "Request Changes",
    detail:
      "Publish your summary and Comments as changes to make before merging.",
    done: "Requested changes on",
  },
};

function isVerdict(value: unknown): value is Verdict {
  return typeof value === "string" && value in verdicts;
}

async function pickVerdict(
  name: string,
  comments: string
): Promise<Verdict | undefined> {
  const picked = await vscode.window.showQuickPick(
    (Object.keys(verdicts) as Verdict[]).map((verdict) => ({
      label: verdicts[verdict].label,
      detail: verdicts[verdict].detail,
      verdict,
    })),
    {
      title: `Submit Review: ${name}`,
      placeHolder: `Your verdict, published to GitHub with a summary and ${comments}`,
      ignoreFocusOut: true,
    }
  );
  return picked?.verdict;
}

/** The only Change of these, or one the Reviewer picks; `none` says why there is none. */
async function pickChange(
  open: Change[],
  title: string,
  none: string
): Promise<Change | undefined> {
  if (open.length === 0) {
    void vscode.window.showInformationMessage(none);
    return;
  }
  if (open.length === 1) return open[0];
  const picked = await vscode.window.showQuickPick(
    open.map((change) => ({
      label: changeName(change),
      description: changeTitle(change),
      change,
    })),
    { title }
  );
  return picked?.change;
}

/** Settings are typed by hand, so accept `~/dev/repo` as well as absolute paths. */
function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/")
    ? path.join(os.homedir(), p.slice(1))
    : p;
}
