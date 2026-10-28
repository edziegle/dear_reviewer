import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  isAllChangesTab,
  Change,
  ChangeRequest,
  OpenDeclined,
  ChangeWorkspace,
  changeHeading,
  changeName,
  changeTitle,
  fetchPullRequest,
  pullRequestName,
  type PullRequestRef,
  showAllChanges,
} from "./changeWorkspace";
import { ChangeFilesNode, ChangeFilesView } from "./changeFiles";
import { changeOfNode } from "./changeOfNode";
import { ClosedChanges } from "./closedChanges";
import { Assistants } from "./assistant/assistant";
import { Briefs } from "./briefs";
import { Conversations } from "./assistant/conversations";
import { DependencyUpdates } from "./dependencyUpdates";
import { Findings } from "./findings";
import {
  ReadingTracker,
  selectionInChange,
  selectionOrScreenInChange,
  whereInChange,
} from "./assistant/selection";
import { ThreadsFiles } from "./assistant/threads";
import { GitHubAuth } from "./github/auth";
import { GitHubClient, PullRequestSummary } from "./github/client";
import { REQUEST_TIMEOUT_MS } from "./github/request";
import { setContext } from "./context";
import { Avatars, InboxNode, InboxTree } from "./inbox";
import { openChoices } from "./openChoices";
import { Lifecycle } from "./lifecycle";
import { LocalPendingReviews } from "./localReviews";
import { LocalClone, Repositories } from "./repositories";
import { ReviewWindow } from "./reviewWindow";
import { GitHubPendingReviews, PendingReviewsBySource } from "./pendingReview";
import { ReviewComments } from "./reviewComments";
import { isVerdict, verdicts, type Verdict } from "./reviewSubmission";
import { ReviewInProgressFiles } from "./reviewInProgress";
import { openReference } from "./references";
import { Repetitions } from "./repetitions";
import {
  CommitFiles,
  commitFileScheme,
  parseCommitFileUri,
  Reviews,
  showChangesSince,
} from "./reviews";
import { countOf, reviewStanding } from "./reviewStanding";
import type { FromWebview, StandingNote } from "./timeline/panel";
import { CodeFlows } from "./codeFlows";
import type { FromCodeFlow } from "./codeFlowPanel";
import { LinkOpener, Standing, Timelines } from "./timeline/timelines";
import {
  GitHubViewedFiles,
  LocalViewedFiles,
  ViewedFilesBySource,
} from "./viewedFiles";
import { ChangeTitles } from "./changeTitles";
import { messageOf } from "./errors";
import { foundText, minimumGapMs, RefreshGate } from "./refreshGate";
import { ReviewWindowTrust } from "./trust";
import { LanguageOffer } from "./highlighting";
import { conversationFolder } from "./conversationName";
import {
  baseChoices,
  headChoices,
  mainOf,
  parseRefs,
  refFormat,
  type Ref,
} from "./commitRange";
import { git } from "./git";
import { FormattingMarks, FormattingWorker } from "./formattingMarks";
import { useFormattingMarks } from "./skimOnly";
import { Dashboard } from "./dashboard/dashboard";
import { IgnoredPullRequests } from "./dashboard/ignored";
import type { FromDashboard } from "./dashboard/view";
import { WindowRequests, type WindowAction } from "./windowRequests";

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
  // A Dependency update's facts, read from its commits once per head commit.
  const dependencyUpdates = new DependencyUpdates(github);
  // For the setup walkthrough's checklist.
  const showSignedIn = async () =>
    setContext("dearReviewer.signedIn", !!(await auth.token(apiUrl())));
  const localViewedFiles = new LocalViewedFiles(
    context.globalStorageUri.fsPath
  );
  const viewedFiles = new ViewedFilesBySource(
    localViewedFiles,
    new GitHubViewedFiles(github)
  );
  // What names a Change where there is room: its pull request's title, once loaded.
  const changeTitles = new ChangeTitles();
  const headingOf = (change: Change) =>
    changeHeading(change, changeTitles.of(change));
  const changeFiles = new ChangeFilesView(
    () => changes.active(),
    viewedFiles,
    path.join(context.globalStorageUri.fsPath, "change-files-view.json"),
    (change) => reviews.lastReview(change),
    (change) => codeColumnOf(change),
    (change) => assistants.readingOrderOf(change),
    headingOf
  );
  context.subscriptions.push({
    dispose: changeTitles.onDidChange(() => {
      changeFiles.refresh();
      assistants.retitle();
    }),
  });
  // Formatting-only files are marked skim-only as a worker thread parses them,
  // beside the extension's own files (ADR 0048).
  const formattingWorker = new FormattingWorker({
    file: path.join(__dirname, "formattingWorker.js"),
    wasmDir: path.join(__dirname, "tree-sitter"),
  });
  const formattingMarks = new FormattingMarks({
    compare: formattingWorker.compare,
    changed: () => changeFiles.refresh(),
  });
  useFormattingMarks(formattingMarks);
  context.subscriptions.push({
    dispose: () => {
      useFormattingMarks(undefined);
      formattingMarks.dispose();
      formattingWorker.dispose();
    },
  });
  const avatars = new Avatars(
    github,
    path.join(context.globalStorageUri.fsPath, "avatars")
  );
  const githubReviews = new GitHubPendingReviews(github);
  const localReviews = new LocalPendingReviews(
    context.globalStorageUri.fsPath,
    () => githubReviews.viewer
  );
  const showError = (message: string, ...actions: string[]) =>
    vscode.window.showErrorMessage(message, ...actions);
  let reportProblem = showError;
  const review = new ReviewComments(
    () => changes.list(),
    new PendingReviewsBySource(localReviews, githubReviews),
    avatars,
    () => changes.active(),
    (message, ...actions) => reportProblem(message, ...actions),
    (change, request) => assistants.writeAgentNote(change, request),
    (message) => notify(message)
  );
  // The Assistant reads the threads from a file, and learns where the Reviewer is reading.
  const threadsFiles = new ThreadsFiles(
    () => changes.shownHere(),
    (change) => review.threadsOf(change),
    review.onDidChange
  );
  // A new thread's button says whether its Change's Review is in progress.
  const reviewInProgress = new ReviewInProgressFiles(
    () => changes.shownHere(),
    (change) => review.pendingCount(change),
    review.onDidChange
  );
  const reading = new ReadingTracker(() => changes.shownHere());
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
  // Notifications with buttons; the tests answer them instead.
  const showInformation = (message: string, ...actions: string[]) =>
    vscode.window.showInformationMessage(message, ...actions);
  let notify = showInformation;
  const conversations = new Conversations(context.globalStorageUri.fsPath);
  const reviews = new Reviews(github, localReviews);
  const repetitions = new Repetitions();
  const assistants = new Assistants(
    (): { command: string[]; path: string } => ({
      command: (
        settings().inspect<unknown[]>("claudeCommand")?.globalValue ?? []
      ).filter((item): item is string => typeof item === "string"),
      path: settings().inspect<string>("claudePath")?.globalValue ?? "",
    }),
    conversations,
    (uri) => openLink(uri),
    (change) => reviews.lastReviewed(change),
    (change) => timelines.codeColumn(change),
    {
      threadsOf: (change) => review.threadsOf(change),
      readingIn: (change) => reading.readingIn(change),
    },
    async (change) =>
      change.pullRequest &&
      github.pullRequestDescription(
        change.pullRequest.repository,
        change.pullRequest.number
      ),
    (change) => changeTitles.of(change),
    (change) => repetitions.candidates(change)
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
    },
    (change) => timelines.codeColumn(change)
  );
  context.subscriptions.push(
    briefs,
    briefs.onDidChange(() => showStanding())
  );
  const reviewWindow = new ReviewWindow(context.globalStorageUri.fsPath);
  // The review window shows the Change in front, and the Reviewer's own
  // windows the Dashboard (ADR 0032); tests, which can't run in the review
  // window, stand in for it.
  let inReviewWindow = () => reviewWindow.isThisWindow();
  const closeWindow = () =>
    void vscode.commands.executeCommand("workbench.action.closeWindow");
  let closeReviewWindow: () => void = closeWindow;
  const showInReviewWindow = () =>
    setContext("dearReviewer.inReviewWindow", inReviewWindow());
  const trust = new ReviewWindowTrust(
    context.globalStorageUri.fsPath,
    () => reviewWindow.isThisWindow(),
    () => changes.showReviewWindow()
  );
  const codeFlows = new CodeFlows(
    (change) => codeColumnOf(change),
    (change, calls) => assistants.walkThroughCodeFlow(change, calls)
  );
  context.subscriptions.push(codeFlows);
  const languageOffer = new LanguageOffer(context.globalState);
  context.subscriptions.push(languageOffer);
  const timelines = new Timelines(github, avatars, (uri) => openLink(uri), {
    standing: (change) => standingOf(change),
    titleLoaded: (change, title) => changeTitles.set(change, title),
    heading: headingOf,
    navigationOff: () => trust.navigationOff,
    take: (change) => assistants.overviewOf(change),
    readingOrder: (change) => changeFiles.readingOrder(change),
    dependencyUpdate: (change) => dependencyUpdates.shown(change),
    repeatedEdits: (change) => repetitions.repeatedEdits(change),
    openSite: (change, site, missed) =>
      missed
        ? void codeColumnOf(change).then((column) =>
            openReference(change, site.path, site.line, site.endLine, column)
          )
        : void changeFiles.openSite(change, site),
    openFile: (change, file) => void changeFiles.openPath(change, file),
    unhighlighted: (files) => languageOffer.unhighlighted(files),
    findExtension: (extension) => languageOffer.find(extension),
    dismissUnhighlighted: (extensions) =>
      void languageOffer.dismiss(extensions),
    pendingComments: (change) => review.pendingComments(change),
    threads: (change) => review.threadsOf(change),
    brief: (change) => briefs.stateOf(change),
    openPending: (change, index) =>
      void review.revealPending(change, index, (file) =>
        changeFiles.openPath(change, file)
      ),
    submit: (change, verdict, summary) =>
      submitReviewOf(change, verdict, summary),
    act: (change, action) => {
      if (action === "ask") void assistants.open(change);
      else if (action === "codeFlow") void codeFlows.show(change);
      else if (action === "findIssues")
        void vscode.commands.executeCommand(
          "dearReviewer.findIssues",
          requestOf(change)
        );
      else if (action === "skimSetting")
        void vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "dearReviewer.visitSkimOnlyFiles"
        );
      else if (action === "showChangesSince")
        void vscode.commands.executeCommand(
          "dearReviewer.showChangesSinceLastReview",
          requestOf(change)
        );
      else if (action === "suggestReadingOrder")
        void assistants.suggestReadingOrder(change);
      else if (action === "takeAction") assistants.helpWithProblem(change);
      else if (action === "takeRetry") void assistants.retry(change);
      else if (action === "trust") void trust.trust();
      else if (action === "copyBrief") void briefs.copyWritten(change);
      else if (action === "showBrief") void briefs.show(change);
      else if (action === "discard")
        void vscode.commands.executeCommand(
          "dearReviewer.discardReview",
          requestOf(change)
        );
      else if (action === "closeChange")
        void vscode.commands.executeCommand(
          "dearReviewer.closeChange",
          requestOf(change)
        );
      else
        void vscode.commands.executeCommand(
          action === "finish"
            ? "dearReviewer.finishReview"
            : "dearReviewer.nextUnviewedFile",
          requestOf(change)
        );
    },
  });

  const windowRequests = new WindowRequests(context.globalStorageUri.fsPath);
  /** Whether this window shows the Change, so it can act on it itself. */
  const showsHere = (change: Change) =>
    changes.shownHere().some((c) => c.id === change.id);
  /**
   * Asks the review window to act on a Change it shows, and brings it
   * forward, opening it if it's closed: it carries the request out once it
   * reads it.
   */
  function askReviewWindow(change: Change, action: WindowAction): void {
    windowRequests.ask(change.id, action);
    void changes.showReviewWindow();
  }
  /**
   * In the review window, carries out what the Reviewer's own window asked
   * of the Changes shown here. A request for a Change whose folders are
   * still on their way waits for them; one for a Change no longer open is
   * dropped.
   */
  function carryOutRequests(): void {
    if (!inReviewWindow()) return;
    const done = new Set<string>();
    for (const request of windowRequests.all()) {
      const open = changes.list().find((c) => c.id === request.change);
      const change = open && changes.shownHere().find((c) => c.id === open.id);
      if (open && !change) continue;
      done.add(request.id);
      if (!change) continue;
      void changes.bringToFront(change).then(() => {
        if (request.action === "finish")
          void vscode.commands.executeCommand(
            "dearReviewer.finishReview",
            requestOf(change)
          );
      });
    }
    if (done.size > 0) windowRequests.done(done);
  }
  const requestsWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(
      vscode.Uri.file(path.dirname(windowRequests.file)),
      path.basename(windowRequests.file)
    )
  );
  context.subscriptions.push(
    requestsWatcher,
    requestsWatcher.onDidCreate(() => carryOutRequests()),
    requestsWatcher.onDidChange(() => carryOutRequests())
  );

  const ignoredPullRequests = new IgnoredPullRequests(
    path.join(context.globalStorageUri.fsPath, "ignored-pull-requests.json")
  );
  const dashboard = new Dashboard(inbox, avatars, ignoredPullRequests, {
    inProgress: () => changes.list(),
    standing: (change) => standingOf(change),
    fileCount: (change) => changeFiles.fileCount(change),
    resume: (change) =>
      showsHere(change)
        ? void changes.bringToFront(change)
        : askReviewWindow(change, "resume"),
    finish: (change) =>
      showsHere(change)
        ? void vscode.commands.executeCommand(
            "dearReviewer.finishReview",
            requestOf(change)
          )
        : askReviewWindow(change, "finish"),
    close: (change) =>
      void vscode.commands.executeCommand(
        "dearReviewer.closeChange",
        requestOf(change)
      ),
    open: (node) =>
      void vscode.commands.executeCommand(
        node.kind === "localBranch"
          ? "dearReviewer.openLocalBranch"
          : "dearReviewer.openPullRequest",
        node
      ),
    openRange: () =>
      void vscode.commands.executeCommand("dearReviewer.openChange"),
    trusted: () => vscode.workspace.isTrusted,
  });
  context.subscriptions.push(dashboard);

  /**
   * Submits the pull request's Review, which ends it, and lets the rest of
   * Dear Reviewer know. Gives what it published, in words, and its page on
   * GitHub; throws if GitHub didn't take it.
   */
  async function submitReviewOf(
    change: Change,
    verdict: Verdict,
    summary: string
  ): Promise<{ text: string; url?: string }> {
    const comments = countOf(review.pendingCount(change), "Comment");
    const submitted = await review.submit(change, verdict, summary);
    changeFiles.reviewEnded(change);
    // GitHub's search lists it as awaiting review for a while yet.
    if (change.pullRequest) inbox.reviewed(change.pullRequest);
    // The Inbox shows which pull requests changed since a Review.
    void inbox.refresh();
    const name = changeName(change);
    const done = verdicts[verdict].done;
    const text =
      comments === "no Comments"
        ? `${done} ${name}.`
        : `${done} ${name} and published ${comments}.`;
    const url =
      submitted.url && /^https?:\/\//i.test(submitted.url)
        ? submitted.url
        : undefined;
    return { text, ...(url && { url }) };
  }

  /** Keeps checks of one Change from overlapping or following each other closely. */
  const refreshGate = new RefreshGate();
  /** What the last check of each Change, by conversation, found, for its overview to say. */
  const arrivals = new Map<string, string>();

  /**
   * Checks the pull request's Change against GitHub (ADR 0036) and brings in
   * what changed: new commits swap the Change in place for the new head, as
   * opening it again would, and its review threads load again. Gives what it
   * found in words, or nothing if it didn't check. An automatic check says
   * nothing of a failure; one the Reviewer asked for throws it.
   */
  async function fetchUpdates(
    change: Change,
    automatic: boolean,
    owed = false
  ): Promise<string | undefined> {
    const pullRequest = change.pullRequest;
    if (!pullRequest) return;
    const end = owed
      ? refreshGate.beginOwed(change.conversation)
      : refreshGate.begin(change.conversation, automatic);
    if (!end) return;
    try {
      const remote = await github.pullRequestHead(
        pullRequest.repository,
        pullRequest.number
      );
      if (!remote) return "Not found on GitHub";
      if (remote.state !== "OPEN") {
        // Over: the Change closes as it does when the Inbox finds it merged.
        await lifecycle.tidy();
        return `Pull request ${remote.state.toLowerCase()}`;
      }
      if (remote.headRefOid === change.headSha) {
        const threads = await review.refreshThreads(change);
        // The note of earlier arrivals stays until something newer arrives.
        if (threads > 0)
          arrivals.set(
            change.conversation,
            foundText({ newCommits: 0, threads })
          );
        showStanding();
        return foundText({ newCommits: 0, threads });
      }
      // Swapping closes the Change's editors, and a Comment still being
      // written in one would be lost.
      if (review.hasOpenDraft(change))
        return "New commits, not brought in while a Comment is being written";
      return await swapToNewHead(change, pullRequest, remote.baseRefName);
    } catch (err) {
      if (!automatic) throw err;
    } finally {
      if (end()) runOwedCheck(change.conversation);
    }
  }

  /**
   * Runs the check a focus event turned away while another ran (ADR 0036), on
   * the Change now shown under the conversation: a swap replaced the one that
   * was checked.
   */
  function runOwedCheck(conversation: string): void {
    const current = changes
      .shownHere()
      .find((shown) => shown.conversation === conversation);
    if (current) void fetchUpdates(current, true, true);
  }

  /** Opens the pull request's new head in place of the Change, and the file the Reviewer was on. */
  async function swapToNewHead(
    change: Change,
    pullRequest: PullRequestRef,
    baseRefName: string
  ): Promise<string> {
    // The file beside the overview, wherever the focus is: VS Code can hand
    // the focus back to an overview a moment after a file opens beside it.
    const onFile = await shownIn(change);
    const reopen =
      onFile?.change.id === change.id ? onFile.file.path : undefined;
    const request = await fetchPullRequest(change.repository, {
      ...pullRequest,
      baseRefName,
    });
    const count = await git(
      change.repository,
      "rev-list",
      "--count",
      `${change.headSha}..${request.head}`
    ).then(
      (n) => Number(n),
      () => 0
    );
    // A force push can leave none that git can count from the old head.
    const newCommits = count > 0 ? count : ("some" as const);
    if (reopen) reopeningFile.add(change.conversation);
    const next = await changes
      .open(request)
      .finally(() => reopeningFile.delete(change.conversation));
    const text = foundText({ newCommits, threads: 0 });
    arrivals.set(next.conversation, text);
    if (reopen) {
      await showingChange.catch(() => undefined);
      await changeFiles.openPath(next, reopen);
    }
    showStanding();
    return text;
  }

  /** Checks every pull request Change this window shows, as it regains focus. */
  function fetchUpdatesOfShown(): void {
    if (settings().get<boolean>("autoRefreshChanges", true) === false) return;
    for (const change of changes.shownHere())
      if (change.pullRequest) void fetchUpdates(change, true);
  }

  /** Where the Reviewer stands on the Change, for its overview. */
  async function standingOf(change: Change): Promise<Standing> {
    const standing: StandingNote[] = [];
    const since = await changeFiles.sinceReview(change);
    const lastReview =
      since && !since.newCommits ? reviewStanding(since.review) : undefined;
    const arrived = arrivals.get(change.conversation);
    if (arrived) standing.push(`${arrived} arrived`);
    if (since?.newCommits)
      standing.push({
        text: "New commits since your Review",
        action: "showChangesSince",
      });
    else if (since && !lastReview)
      standing.push("Nothing new since your Review");
    const pending = await review.pendingCountOf(change);
    if (pending > 0) standing.push(countOf(pending, "pending Comment"));
    const { viewed, total } = await changeFiles.viewedCount(change);
    standing.push(`${viewed} of ${total} viewed`);
    return {
      review: lastReview,
      notes: standing,
      viewed,
      total,
      reviewed: !!since && !since.newCommits,
      pending,
    };
  }
  context.subscriptions.push(trust.onDidChangeNavigation(() => showStanding()));
  // The overview lists missed sites once the repository's index is built.
  repetitions.onDidSettle(() => showStanding());
  context.subscriptions.push(
    languageOffer.onDidChange(() => timelines.refreshUnhighlighted())
  );

  // Many threads load at once, so the overviews catch up once they have.
  let standingTimer: NodeJS.Timeout | undefined;
  function showStanding(): void {
    clearTimeout(standingTimer);
    standingTimer = setTimeout(() => {
      void timelines.refreshStanding();
      dashboard.refresh();
    }, 50);
  }
  const findings = new Findings(
    context.extensionUri,
    () => changes.active(),
    (change) => assistants.findIssues(change),
    (change, note) => assistants.addNote(change, note),
    (change, place) => review.onDiff(change, place),
    (change, place, body) => review.draft(change, place, body),
    context.extensionMode === vscode.ExtensionMode.Test
  );

  /** Steps from the Finding a hover's link names, or else from the cursor. */
  async function stepFinding(
    direction: 1 | -1,
    target: string | undefined
  ): Promise<void> {
    const from = target === undefined ? undefined : findings.get(target);
    if (!(await findings.step(direction, from)))
      void vscode.window.showInformationMessage(
        "There are no Findings. Ask for Findings on a Change to have the Assistant raise some."
      );
  }

  /** Lets go of a Change that was closed: its panels, Comments, Findings and viewed files. */
  async function letGo(
    change: Change,
    movedToNewerHead = false
  ): Promise<void> {
    assistants.close(change, !movedToNewerHead);
    timelines.close(change);
    codeFlows.close(change);
    review.forget(change);
    findings.forget(change);
    await viewedFiles.forget(change);
  }

  // Opening another Change stops reviewing this one, losing a Comment still
  // being written in it, so the Reviewer is asked first (ADR 0040).
  let discardAnswer: boolean | undefined;
  const discardAsked: string[] = [];
  changes.confirmStopping = async (active) => {
    if (!review.hasOpenDraft(active)) return true;
    const question = `Discard the Comment you're writing on ${changeName(active)}?`;
    discardAsked.push(question);
    // The tests answer for the Reviewer, whose modal they can't click.
    if (discardAnswer !== undefined) return discardAnswer;
    const discard = "Discard";
    const answer = await vscode.window.showWarningMessage(
      question,
      { modal: true },
      discard
    );
    return answer === discard;
  };

  /** The Changes the last sync saw open, to let go of those that left the list. */
  const closedChanges = new ClosedChanges<Change>();

  const lifecycle = new Lifecycle(
    changes,
    github,
    { conversations, localReviews, briefs, viewedFiles: localViewedFiles },
    async (clone) =>
      (await repositories.inboxClones()).find(
        (c) => path.resolve(c.clone) === path.resolve(clone)
      )?.repository,
    async (change) => {
      await letGo(change);
      void syncOpenChanges();
    }
  );

  /**
   * Shows a Change the way a review starts (ADR 0020): its overview alone in
   * the main column, with the focus, Change Files in the side bar, and
   * nothing of other Changes or of the last session: no bottom panel, and no
   * other Change's editors or overview. The Assistant's view follows it.
   * A Change whose conversation is `reopeningFile` leaves the focus to the
   * file that opens beside its overview next.
   */
  function showChange(change: Change): Promise<void> {
    shownLast = change.id;
    shownChanges.push(changeName(change));
    const focus = !reopeningFile.has(change.conversation);
    // A failed showing doesn't hold up the next.
    showingChange = showingChange
      .catch(() => undefined)
      .then(async () => {
        await vscode.commands.executeCommand("workbench.action.closePanel");
        await closeOtherChangesEditors(change);
        timelines.closeOthers(change);
        await vscode.commands.executeCommand("dearReviewer.changeFiles.focus");
        void assistants.start(change);
        await timelines.open(change, focus);
      });
    return showingChange;
  }
  /**
   * The conversations of Changes a swap is opening at a new head with the
   * file the Reviewer was on. VS Code reports that a webview gained the
   * focus on a timer, so an overview given the focus can take it back from
   * a file opened beside it a moment later.
   */
  const reopeningFile = new Set<string>();
  /** The id of the Change shown last, as a review starts. */
  let shownLast: string | undefined;
  /** Every Change shown as a review starts, by name, for the tests. */
  const shownChanges: string[] = [];
  /** Settles once the Change being shown is in front, so a diff can open after it. */
  let showingChange = Promise.resolve();

  /** The column the Change's code opens in, beside its overview, once that has opened. */
  async function codeColumnOf(change: Change): Promise<vscode.ViewColumn> {
    await showingChange.catch(() => undefined);
    return timelines.codeColumn(change);
  }

  /** Focuses the Change's code column, where a multi-file diff, which takes no column, then opens. */
  async function focusCodeColumn(change: Change): Promise<void> {
    await vscode.commands.executeCommand(
      (await codeColumnOf(change)) === vscode.ViewColumn.Two
        ? "workbench.action.focusSecondEditorGroup"
        : "workbench.action.focusFirstEditorGroup"
    );
  }

  /** Focuses the editor group in the column, as the "Focus … Editor Group" commands do. */
  async function focusEditorGroup(column: vscode.ViewColumn): Promise<void> {
    const nth = [
      "First",
      "Second",
      "Third",
      "Fourth",
      "Fifth",
      "Sixth",
      "Seventh",
      "Eighth",
    ];
    await vscode.commands.executeCommand(
      `workbench.action.focus${nth[column - 1] ?? "Last"}EditorGroup`
    );
  }

  /**
   * Shows the Change's multi-file diff in its code column, beside its
   * overview. The diff opens in the active group, and an overview given the
   * focus can make its own group active again a moment after the code column
   * got the focus (see `MarkdownPanel.ready`). So the overview's group is
   * locked meanwhile: VS Code opens nothing new in a locked group, and opens
   * the diff in the code column instead. Locking and unlocking act on the
   * active group, which the overview can only make its own.
   */
  async function showAllChangesBesideOverview(change: Change): Promise<void> {
    await showingChange.catch(() => undefined);
    const overview = timelines.overviewColumn(change);
    if (overview === undefined) {
      await focusCodeColumn(change);
      await showAllChanges(change);
    } else {
      await focusEditorGroup(overview);
      await vscode.commands.executeCommand("workbench.action.lockEditorGroup");
      try {
        await focusCodeColumn(change);
        await showAllChanges(change);
      } finally {
        await focusEditorGroup(overview);
        await vscode.commands.executeCommand(
          "workbench.action.unlockEditorGroup"
        );
        await focusCodeColumn(change);
      }
    }
    const column = await codeColumnOf(change);
    const shown = vscode.window.tabGroups.all
      .filter((group) => group.viewColumn === column)
      .some((group) =>
        group.tabs.some((tab) => tab.isActive && isAllChangesTab(change, tab))
      );
    if (!shown)
      void vscode.window.showErrorMessage(
        `The diff of all of ${changeName(change)}'s changes didn't open beside its overview.`
      );
  }

  /**
   * Closes the editor tabs of files in other Changes' worktrees, including
   * those a past session left behind, and of what changed since their last
   * Review.
   */
  async function closeOtherChangesEditors(change: Change): Promise<void> {
    const changesDir = path.join(context.globalStorageUri.fsPath, "changes");
    const isOthers = (uri: vscode.Uri) => {
      if (uri.scheme === commitFileScheme)
        return parseCommitFileUri(uri).changeId !== change.id;
      if (uri.scheme !== "file") return false;
      const inside = (dir: string) =>
        uri.fsPath === dir || uri.fsPath.startsWith(dir + path.sep);
      return (
        inside(changesDir) && !inside(change.baseDir) && !inside(change.headDir)
      );
    };
    // A multi-file diff's tab has no typed input, so its title tells: this
    // Change's is named after it and its head, an older one after commits.
    // VS Code adds the file count, as in "acme/api #7 · all changes (4 files)".
    const isOthersMultiDiff = (label: string) => {
      const all = / · all changes(?: \(\d+ files?\))?$/.exec(label);
      if (all) return label.slice(0, all.index) !== changeName(change);
      return (
        /\b[0-9a-f]{7}\.\.[0-9a-f]{7}\b/.test(label) &&
        !label.includes(change.headSha.slice(0, 7))
      );
    };
    const tabs = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter((tab) => {
        const input = tab.input;
        if (input instanceof vscode.TabInputText) return isOthers(input.uri);
        if (input instanceof vscode.TabInputTextDiff)
          return isOthers(input.original) || isOthers(input.modified);
        // VS Code may give no input at all for a tab it has no API type for.
        if (input === undefined) return isOthersMultiDiff(tab.label);
        if (typeof input !== "object") return false;
        return (
          !(input instanceof vscode.TabInputWebview) &&
          !(input instanceof vscode.TabInputCustom) &&
          !(input instanceof vscode.TabInputNotebook) &&
          !(input instanceof vscode.TabInputNotebookDiff) &&
          !(input instanceof vscode.TabInputTerminal) &&
          isOthersMultiDiff(tab.label)
        );
      });
    if (tabs.length > 0) await vscode.window.tabGroups.close(tabs, true);
  }

  /**
   * Shows which Changes are open: the one in front in Change Files,
   * Findings and the Assistant's view, and to the review keybindings and the
   * palette, which work while one is in front in this window; and every one
   * in the Inbox.
   */
  function showOpenChanges(): void {
    changeFiles.refresh();
    findings.refresh();
    inbox.redraw();
    dashboard.refresh();
    const front = changes.active();
    assistants.follow(front);
    void setContext("dearReviewer.hasOpenChange", !!front);
    // The palette offers the one way to finish that fits the Change in front.
    void setContext("dearReviewer.frontIsPullRequest", !!front?.pullRequest);
    showFrontComments();
  }

  /** Whether the Change in front has Comments pending, for Write Brief…, which has nothing to write from without one. */
  function showFrontComments(): void {
    const front = changes.active();
    void setContext(
      "dearReviewer.frontHasComments",
      !!front && review.pendingCount(front) > 0
    );
  }

  /**
   * Catches up with the open Changes, which any window may have changed:
   * lets go of those that closed, shows them, and, if the Change shown last
   * closed, shows the one now in front the way a review starts; in the review window, also shows the
   * Changes sent here from another window. While this window is opening or
   * closing Changes, or a Change sent here still waits to show, the one in
   * front may be passing, so it waits to show it until they settle.
   */
  function syncOpenChanges(): Promise<void> {
    // Another window may have closed Changes this one still holds state for.
    const closed = closedChanges.leftSince(changes.list());
    for (const gone of closed) void letGo(gone).catch(() => undefined);
    if (closed.length > 0) dashboard.changeClosedElsewhere();
    showOpenChanges();
    const front = changes.active();
    carryOutRequests();
    if (!front) shownLast = undefined;
    else if (
      !changes.busy &&
      !changes.waitingHere() &&
      shownLast &&
      front.id !== shownLast &&
      !changes.list().some((change) => change.id === shownLast)
    )
      void showChange(front);
    return changes.showPendingDiffs();
  }

  /**
   * The file of a Change open in this window that the active editor tab
   * shows, either side of a diff, or at the reviewed commit of what changed
   * since the last Review.
   */
  function activeFile(): ReturnType<typeof whereInChange> {
    return fileIn(vscode.window.tabGroups.activeTabGroup.activeTab);
  }

  /** The file of a Change open in this window that the tab shows, as for `activeFile`. */
  function fileIn(
    tab: vscode.Tab | undefined
  ): ReturnType<typeof whereInChange> {
    const shown = changes.shownHere();
    const input = tab?.input;
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

  /**
   * Marks files viewed or not: the Change file a tab shows, from its menu or
   * title bar, or Change Files elements, from its menu, the ones selected
   * with it, or else the view's selection.
   */
  async function setViewed(
    viewed: boolean,
    target?: ChangeFilesNode | vscode.Uri,
    selected?: unknown
  ): Promise<void> {
    if (target instanceof vscode.Uri) {
      const where = await worktreeFile(target);
      if (!where) return;
      return changeFiles.setFilesViewed(
        where.change,
        [where.file.path],
        viewed
      );
    }
    await changeFiles.setViewed(
      Array.isArray(selected)
        ? (selected as ChangeFilesNode[])
        : target
          ? [target]
          : [...changeFilesTree.selection],
      viewed
    );
  }

  /**
   * The Change file in one of its worktrees, which has a viewed state, unlike
   * the commit side or a file of the worktree the Change doesn't change.
   */
  async function worktreeFile(
    uri: vscode.Uri
  ): Promise<ReturnType<typeof whereInChange>> {
    return viewable(whereInChange(uri, changes.shownHere()));
  }

  async function viewable(
    where: ReturnType<typeof whereInChange>
  ): Promise<ReturnType<typeof whereInChange>> {
    if (!where || where.file.side === "commit") return;
    return (await changeFiles.changesFile(where.change, where.file.path))
      ? where
      : undefined;
  }

  /** Closes the tabs that show the file, on its own or as a side of a diff. */
  async function closeTabsOf(file: vscode.Uri): Promise<void> {
    const shows = (uri: vscode.Uri) => uri.toString() === file.toString();
    const tabs = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter(({ input }) =>
        input instanceof vscode.TabInputTextDiff
          ? shows(input.original) || shows(input.modified)
          : input instanceof vscode.TabInputText && shows(input.uri)
      );
    await vscode.window.tabGroups.close(tabs);
  }

  /** The Change open in this window of the panel or editor the Reviewer is looking at. */
  function activeChange(): Change | undefined {
    const panel = timelines.activeChangeId();
    if (panel) return changes.shownHere().find((c) => c.id === panel);
    return activeFile()?.change;
  }

  /**
   * The Change a command acts on: the one given, by a Change Files menu,
   * its title bar (which gives the row in focus, of any kind) or a test, if
   * it fits, or the one of the file given, by an editor's title bar (none if
   * that one isn't open here), or else the one the Reviewer is looking at,
   * or else the Change in front, if it fits. A row in no Change counts as
   * none given. `none` says why there is none, and it never returns without
   * the Reviewer having been told why, except when they cancel a pick.
   */
  async function changeFor(
    target: ChangeTarget | vscode.Uri | undefined,
    title: string,
    fits: (change: Change) => boolean = () => true,
    none = "No Change is active in this window."
  ): Promise<Change | undefined> {
    if (target instanceof vscode.Uri) {
      const ofFile = whereInChange(target, changes.shownHere())?.change;
      if (!ofFile)
        void vscode.window.showErrorMessage(
          "The file's Change isn't open in this window."
        );
      return ofFile;
    }
    const ofNode = target && "kind" in target && changeOfNode(target);
    if (ofNode) {
      if (fits(ofNode)) return ofNode;
      void vscode.window.showInformationMessage(none);
      return;
    }
    if (target && !("kind" in target)) {
      const change = await changes.find(target);
      if (!change)
        void vscode.window.showErrorMessage(
          "The Change isn't open in this window."
        );
      return change;
    }
    const looking = activeChange();
    if (looking && fits(looking)) return looking;
    const front = changes.active();
    // The way to a Change: the Dashboard, or in the review window, a commit range.
    const way = inReviewWindow()
      ? { title: "Open Commit Range…", command: "dearReviewer.openChange" }
      : { title: "Show Dashboard", command: "dearReviewer.showDashboard" };
    return pickChange(front && fits(front) ? [front] : [], title, none, way);
  }

  /**
   * The file the Reviewer is on: the one the active tab shows, or, from an
   * overview, the one in front of its code column. VS Code can hand the focus
   * back to an overview a moment after a file opens beside it.
   */
  async function fileOn(): Promise<ReturnType<typeof whereInChange>> {
    const active = activeFile();
    if (active) return active;
    const overview = timelines.activeChangeId();
    const change = changes.shownHere().find((c) => c.id === overview);
    return change && shownIn(change);
  }

  /** The file of the Change shown in front of its code column. */
  async function shownIn(
    change: Change
  ): Promise<ReturnType<typeof whereInChange>> {
    const column = await codeColumnOf(change);
    return fileIn(
      vscode.window.tabGroups.all.find((g) => g.viewColumn === column)
        ?.activeTab
    );
  }

  /**
   * Moves to the next or previous file not yet viewed, first marking the one
   * shown viewed if asked: the one given, by its title bar, or else the
   * active one.
   */
  async function stepUnviewed(
    direction: 1 | -1,
    markShown: boolean,
    target?: ChangeTarget,
    shown?: vscode.Uri
  ): Promise<void> {
    // Given a Change, such as by its overview, step through that one.
    const given = target && (await changeFor(target, "Next Unviewed File"));
    if (target && !given) return;
    // The overview's button leaves the overview in front, so step from its
    // code column rather than the focused group.
    const where = given
      ? await shownIn(given)
      : shown
        ? whereInChange(shown, changes.shownHere())
        : await fileOn();
    const here =
      where?.file.side === "commit" || (given && where?.change.id !== given.id)
        ? undefined
        : where;
    if (markShown && !(await viewable(here))) {
      void vscode.window.showInformationMessage(
        "Open a file's diff from Change Files to mark it viewed."
      );
      return;
    }
    const change =
      given ??
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
    else void offerToFinish(change);
  }

  /**
   * Once every file of the Change is viewed, brings its overview forward
   * with the focus on its filled finishing button, the next step.
   */
  async function offerToFinish(change: Change): Promise<void> {
    await timelines.finish(change);
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
        `Added ${result.repository} to the Dashboard, with its clone at ${chosen}.`
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
        openLabel: "Add to Dashboard",
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
          if (err instanceof OpenDeclined) return;
          // Git's own words run to several lines; the first says what failed.
          const message = messageOf(err).split(/\r?\n/, 1)[0].trim();
          void vscode.window.showErrorMessage(
            `Couldn't open the Change. ${message}`
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
            if (err instanceof OpenDeclined) return;
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
    vscode.commands.registerCommand("dearReviewer.openFromList", async () => {
      // The same pull requests and branches the Dashboard lists, for a
      // Reviewer who keeps their hands on the keys.
      const { groups } = await inbox.contents();
      const choices = openChoices(groups);
      if (choices.length === 0) {
        const dashboardAction = "Show Dashboard";
        const picked = await vscode.window.showInformationMessage(
          "No pull requests or branches are waiting. The Dashboard says why, and has Refresh.",
          dashboardAction
        );
        if (picked === dashboardAction) await dashboard.show();
        return;
      }
      const items: (vscode.QuickPickItem & { choice?: (typeof choices)[0] })[] =
        [];
      let group: string | undefined;
      for (const choice of choices) {
        if (choice.group !== group) {
          group = choice.group;
          items.push({
            label: group,
            kind: vscode.QuickPickItemKind.Separator,
          });
        }
        items.push({
          label: choice.label,
          description: choice.description,
          detail: choice.detail,
          choice,
        });
      }
      const picked = await vscode.window.showQuickPick(items, {
        title: "Open Pull Request or Branch",
        placeHolder: "Choose a pull request or branch to open as a Change",
        matchOnDescription: true,
        matchOnDetail: true,
      });
      if (!picked?.choice) return;
      await vscode.commands.executeCommand(
        picked.choice.node.kind === "localBranch"
          ? "dearReviewer.openLocalBranch"
          : "dearReviewer.openPullRequest",
        picked.choice.node
      );
    }),
    vscode.commands.registerCommand("dearReviewer.showDashboard", () =>
      dashboard.show()
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
          if (err instanceof OpenDeclined) return;
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
              "Stop Reviewing",
              "No Change is open."
            ));
          request = change && requestOf(change);
        }
        if (!request) return;
        await letGo(await changes.close(request));
        void syncOpenChanges();
        changes.closeWindowIfEmptied();
      }
    ),
    // A Change opens with its overview alone; the Assistant starts behind
    // it, writing the overview's summary, and its panel opens when the
    // Reviewer asks (ADR 0019, ADR 0020).
    timelines,
    changes.onDidShowChange((change) => {
      showOpenChanges();
      void showChange(change);
    }),
    assistants,
    changes.onDidEmptyReviewWindow(() => closeReviewWindow()),
    changes.onDidReplaceChange(async ({ older, by }) => {
      await letGo(older, older.conversation === by.conversation);
      showOpenChanges();
    }),
    assistants.onDidChangeOverview((conversation) =>
      timelines.refreshTake(conversation)
    ),
    // Change Files lists the Reading Order, and the overview follows it.
    assistants.onDidChangeReadingOrder(() => changeFiles.refresh()),
    changeFiles.onDidChangeTreeData(() => showStanding()),
    review.onDidChange(() => {
      showStanding();
      showFrontComments();
    }),
    review,
    threadsFiles,
    reviewInProgress,
    reading,
    changes.onDidShowChange((change) => void review.retry([change])),
    // Start Review is Add Comment, labelled by whether the Review is in progress.
    ...["addComment", "startReview"].map((command) =>
      vscode.commands.registerCommand(
        `dearReviewer.${command}`,
        (reply: vscode.CommentReply) => review.addComment(reply)
      )
    ),
    vscode.commands.registerCommand(
      "dearReviewer.addToReview",
      (reply: vscode.CommentReply) => review.addToReview(reply)
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
      "dearReviewer.addAgentNote",
      (comment: vscode.Comment) => review.addAgentNote(comment)
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
          "No pull request's Change is active in this window. A local Change's Review ends with a Brief."
        );
        if (!change) return;
        if (!change.pullRequest) {
          void vscode.window.showErrorMessage(
            "Only a pull request's Change is submitted as a Review. A local Change's Review ends with a Brief."
          );
          return;
        }
        // Menus of a tree that selects many pass the selection after the node.
        const verdict = isVerdict(given) ? given : undefined;
        await review.ensureLoaded(change);
        // A verdict and summary given, as by a test, submit straight away;
        // otherwise the Review ends in its overview's Submit step (ADR 0033).
        if (!verdict || typeof givenSummary !== "string")
          return timelines.submit(change, verdict);
        const name = changeName(change);
        const submitted = await vscode.window
          .withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Submitting your Review of ${name}…`,
            },
            () => submitReviewOf(change, verdict, givenSummary)
          )
          .then(undefined, (err: unknown) => {
            void vscode.window.showErrorMessage(
              `Couldn't submit your Review of ${name}: ${messageOf(err)}`
            );
            return undefined;
          });
        if (!submitted) return;
        void timelines.refresh(change);
        const viewOnGitHub = "View on GitHub";
        const url = submitted.url;
        void notify(submitted.text, ...(url ? [viewOnGitHub] : [])).then(
          (picked) => {
            if (picked === viewOnGitHub && url)
              return openLink(vscode.Uri.parse(url));
          }
        );
      }
    ),
    vscode.commands.registerCommand(
      "dearReviewer.viewOnGitHub",
      async (target?: ChangeTarget) => {
        const change = await changeFor(
          target,
          "View on GitHub",
          (c) => !!c.pullRequest,
          "No pull request's Change is active in this window. A local Change has no page on GitHub."
        );
        if (!change) return;
        if (!change.pullRequest) {
          void reportProblem(
            "Only a pull request's Change has a page on GitHub."
          );
          return;
        }
        const url = timelines.pullRequestUrl(change);
        if (!url || !/^https?:\/\//i.test(url)) {
          void reportProblem(
            `${changeName(change)} hasn't loaded from GitHub yet. Try again once its overview has.`
          );
          return;
        }
        await openLink(vscode.Uri.parse(url, true));
      }
    ),
    vscode.commands.registerCommand(
      "dearReviewer.discardReview",
      async (target?: ChangeTarget, confirmed?: unknown) => {
        const change = await changeFor(target, "Discard Pending Comments");
        if (!change) return;
        await review.ensureLoaded(change);
        const name = changeName(change);
        const count = review.pendingCount(change);
        if (count === 0) {
          void vscode.window.showInformationMessage(
            `You have no pending Comments on ${name} to discard.`
          );
          return;
        }
        const comments = countOf(count, "Comment");
        const discard = "Discard Comments";
        if (confirmed !== true) {
          const picked = await vscode.window.showWarningMessage(
            change.pullRequest
              ? `Discard the ${comments} you haven't submitted on ${name}? They will be deleted without being published. This can't be undone.`
              : `Discard the ${comments} you haven't briefed on ${name}? They will be deleted, and no Brief written from them. This can't be undone.`,
            { modal: true },
            discard
          );
          if (picked !== discard) return;
        }
        if (await review.discard(change)) {
          changeFiles.refresh();
          void vscode.window.showInformationMessage(
            `Discarded the ${comments} on ${name}.`
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
          "No local Change is active in this window. A pull request's Review ends when you submit it."
        );
        if (!change) return;
        if (change.pullRequest) {
          void vscode.window.showErrorMessage(
            "A pull request's Review ends when you submit it; a Brief ends a local Change's Review."
          );
          return;
        }
        // A Change fully viewed with no Comments has nothing to brief: its
        // overview says so, with Stop Reviewing as the next step.
        if (review.pendingCount(change) === 0) {
          const { viewed, total } = await changeFiles.viewedCount(change);
          if (total > 0 && viewed >= total) {
            await timelines.finish(change);
            return;
          }
        }
        // The overview shows the Brief being written, and then waiting to be copied.
        await timelines.open(change, true);
        await briefs.write(change);
      }
    ),
    vscode.commands.registerCommand(
      "dearReviewer.finishReview",
      async (target?: ChangeTarget | vscode.Uri) => {
        const change = await changeFor(target, "Submit Review or Write Brief");
        if (!change) return;
        await vscode.commands.executeCommand(
          change.pullRequest
            ? "dearReviewer.submitReview"
            : "dearReviewer.writeBrief",
          requestOf(change)
        );
      }
    ),
    // The review keys can be rebound, as any keybinding, in Keyboard Shortcuts.
    vscode.commands.registerCommand("dearReviewer.showReviewKeys", () =>
      vscode.commands.executeCommand(
        "workbench.action.openGlobalKeybindings",
        "@ext:edziegle.dear-reviewer"
      )
    ),
    vscode.commands.registerCommand(
      "dearReviewer.copyBrief",
      (uri?: vscode.Uri) => briefs.copy(uri)
    ),
    findings,
    vscode.commands.registerCommand(
      "dearReviewer.findIssues",
      async (target?: ChangeTarget) => {
        const change = await changeFor(target, "Ask for Findings");
        if (change) await findings.find(change);
      }
    ),
    vscode.commands.registerCommand(
      "dearReviewer.dismissFinding",
      (target?: string) => {
        const finding = findings.get(target);
        if (finding) findings.dismiss(finding);
        else showNoFinding();
      }
    ),
    vscode.commands.registerCommand(
      "dearReviewer.convertFinding",
      async (target?: string) => {
        const finding = findings.get(target);
        if (finding) await findings.convert(finding);
        else showNoFinding();
      }
    ),
    vscode.commands.registerCommand(
      "dearReviewer.askAboutFinding",
      async (target?: string) => {
        const finding = findings.get(target);
        if (!finding) {
          showNoFinding();
          return;
        }
        // Its own Change's Assistant, whichever Change is in front: the
        // Finding belongs to that conversation.
        const selection = await findings.selectionOf(finding);
        if (selection) await assistants.addSelection(finding.change, selection);
        else
          void vscode.window.showErrorMessage(
            `Couldn't read ${finding.place.path} to ask the Assistant about the Finding.`
          );
      }
    ),
    vscode.commands.registerCommand(
      "dearReviewer.showCodeFlow",
      async (target?: ChangeTarget | vscode.Uri) => {
        const change = await changeFor(target, "Show Code Flow");
        if (change) await codeFlows.show(change);
      }
    ),
    vscode.commands.registerCommand(
      "dearReviewer.nextFinding",
      (target?: string) => stepFinding(1, target)
    ),
    vscode.commands.registerCommand(
      "dearReviewer.previousFinding",
      (target?: string) => stepFinding(-1, target)
    ),
    vscode.commands.registerCommand(
      "dearReviewer.nextUnviewedFile",
      (target?: ChangeTarget) => stepUnviewed(1, false, target)
    ),
    vscode.commands.registerCommand("dearReviewer.previousUnviewedFile", () =>
      stepUnviewed(-1, false)
    ),
    vscode.commands.registerCommand(
      "dearReviewer.markViewedAndNext",
      (file?: unknown) =>
        stepUnviewed(
          1,
          true,
          undefined,
          file instanceof vscode.Uri ? file : undefined
        )
    ),
    vscode.commands.registerCommand(
      "dearReviewer.revealFinding",
      async (target?: string) => {
        const finding = findings.get(target);
        if (finding) await findings.open(finding);
      }
    ),
    vscode.commands.registerCommand(
      "dearReviewer.showChangesSinceLastReview",
      async (target?: ChangeTarget) => {
        const change = await changeFor(
          target,
          "Show Changes Since Your Last Review"
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
        await focusCodeColumn(change);
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
      async (target?: ChangeTarget | vscode.Uri) => {
        const change = await changeFor(target, "Show Overview");
        if (!change) return;
        void assistants.start(change);
        await timelines.open(change, true);
      }
    ),
    vscode.commands.registerCommand(
      "dearReviewer.openAllChanges",
      async (target?: ChangeTarget) => {
        const change = await changeFor(target, "Open All Diffs");
        if (!change) return;
        await showAllChangesBesideOverview(change);
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
    vscode.commands.registerCommand("dearReviewer.askAssistant", async () => {
      const editor = vscode.window.activeTextEditor;
      const found =
        editor && selectionOrScreenInChange(editor, changes.shownHere());
      if (found) {
        await assistants.addSelection(found.change, found.selection);
        return;
      }
      const change = await changeFor(undefined, "Ask the Assistant");
      if (change) await assistants.open(change);
    }),
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
      void review.sync();
      return syncOpenChanges();
    }),
    // Another window may change the open Changes without changing this
    // window's folders, such as by opening again a Change it shows.
    changes.onDidChangeOpenChanges(() => syncOpenChanges()),
    changes.onDidSettle(() => syncOpenChanges()),
    changes,
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
      (target?: ChangeFilesNode | vscode.Uri, selected?: unknown) =>
        setViewed(true, target, selected)
    ),
    vscode.commands.registerCommand(
      "dearReviewer.markViewedAndClose",
      async (file?: vscode.Uri) => {
        if (!file || !(await worktreeFile(file))) return;
        await setViewed(true, file);
        await closeTabsOf(file);
      }
    ),
    vscode.commands.registerCommand(
      "dearReviewer.unmarkViewed",
      (target?: ChangeFilesNode | vscode.Uri, selected?: unknown) =>
        setViewed(false, target, selected)
    ),
    vscode.commands.registerCommand("dearReviewer.refreshChangeFiles", () =>
      changeFiles.refresh()
    ),
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) fetchUpdatesOfShown();
    }),
    vscode.commands.registerCommand(
      "dearReviewer.fetchUpdates",
      async (target?: ChangeTarget) => {
        const change = await changeFor(
          target,
          "Fetch Updates",
          (c) => !!c.pullRequest,
          "No pull request is open in this window."
        );
        if (!change) return;
        try {
          const found = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Fetching updates for ${changeName(change)}…`,
            },
            async () =>
              (await fetchUpdates(change, false)) ?? "Already checking"
          );
          void notify(`${pullRequestName(change.pullRequest!)}: ${found}.`);
        } catch (err) {
          void reportProblem(
            `Couldn't fetch updates for ${changeName(change)}. ${messageOf(err)}`
          );
        }
      }
    ),
    vscode.commands.registerCommand("dearReviewer.hideViewedFiles", () =>
      changeFiles.setHideViewed(true)
    ),
    vscode.commands.registerCommand("dearReviewer.showViewedFiles", () =>
      changeFiles.setHideViewed(false)
    ),
    vscode.commands.registerCommand("dearReviewer.sortByReadingOrder", () =>
      changeFiles.setSortBy("readingOrder")
    ),
    vscode.commands.registerCommand("dearReviewer.sortByTree", () =>
      changeFiles.setSortBy("tree")
    ),
    vscode.commands.registerCommand(
      "dearReviewer.suggestReadingOrder",
      async (target?: ChangeTarget) => {
        const change = await changeFor(target, "Suggest Reading Order");
        if (change) await assistants.suggestReadingOrder(change);
      }
    ),
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
    vscode.commands.registerCommand("dearReviewer.openReviewTools", () =>
      vscode.commands.executeCommand(
        "workbench.action.openWalkthrough",
        `${context.extension.id}#review`,
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
    trust,
    inbox,
    vscode.commands.registerCommand("dearReviewer.trustReviewWindow", () =>
      trust.trust()
    ),
    vscode.commands.registerCommand("dearReviewer.signIn", () => auth.signIn()),
    vscode.commands.registerCommand("dearReviewer.forgetToken", () =>
      auth.forgetToken(apiUrl())
    ),
    auth.onDidChange(() => {
      void showSignedIn();
      void lifecycle.tidy();
      void review.retry();
      void timelines.refreshAll();
      return inbox.refresh();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      // Change Files compacts folders as the Explorer does.
      if (e.affectsConfiguration("explorer.compactFolders"))
        changeFiles.refresh();
      if (e.affectsConfiguration("dearReviewer.githubApiUrl")) {
        // Which remotes are on GitHub depends on the API's host.
        void repositories.scanWindow();
        void showSignedIn();
        void review.retry();
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
  void showInReviewWindow();
  showOpenChanges();
  void lifecycle.tidy();
  void changes.showPendingDiffs();
  void review.sync();
  // After a reload, the review starts quiet again, at the Change opened last.
  const latest = changes.shownHere().at(-1);
  if (latest) void showChange(latest);
  carryOutRequests();
  // The views are how the Reviewer sees the Inbox, a Change's files, the
  // Assistant and their Comments; tests read them the same way.
  return {
    inbox,
    changeFiles,
    findings: {
      view: findings.view,
      decorated: () => findings.decorated(),
      hovers: () => findings.hovers(),
    },
    review: {
      controller: review.controller,
      threads: () => review.threads(),
      inProgressFiles: () => reviewInProgress.paths,
    },
    assistant: {
      panels: () => assistants.panels(),
      emptyView: () => assistants.emptyView(),
      view: () => assistants.viewState(),
      overviews: () => assistants.overviews(),
      loginStatus: () => assistants.loginStatus(),
      /** The folder the conversation of the Change the request opens runs `claude` in, by name. */
      conversationFolder: async (request: ChangeRequest) =>
        conversationFolder(await changes.conversationFor(request)),
    },
    timeline: {
      panels: () =>
        timelines.panels().map((panel) => ({
          title: panel.title,
          sent: panel.sent,
          rendered: panel.rendered,
          openedWithFocus: panel.openedWithFocus,
          receive: (message: FromWebview) => panel.receive(message),
        })),
    },
    codeFlow: {
      panels: () =>
        codeFlows.panels().map(({ title, panel }) => ({
          title,
          viewColumn: panel.viewColumn,
          sent: panel.sent,
          rendered: panel.rendered,
          layout: panel.layout,
          scrollCanvas: (left: number, top: number) =>
            panel.scrollCanvas(left, top),
          focusNode: (id: string) => panel.focusNode(id),
          receive: (message: FromCodeFlow) => panel.receive(message),
        })),
      /** Shortens how long Code Flow waits for a language server to answer. */
      setWaitMs: (ms: number | undefined) => codeFlows.setWaitMs(ms),
    },
    dashboard: {
      views: () =>
        dashboard.views().map((view) => ({
          visible: view.visible,
          sent: view.sent,
          rendered: view.rendered,
          receive: (message: FromDashboard) => view.receive(message),
        })),
      /** Asks the review window to act on an open Change, as another window's Dashboard would. */
      askReviewWindow: (id: string, action: WindowAction) =>
        windowRequests.ask(id, action),
      /** Catches up with the open Changes, as the watcher of their shared list does. */
      syncOpenChanges: () => syncOpenChanges(),
      /** The folder of the list of open Changes every window shares. */
      storageDir: context.globalStorageUri.fsPath,
      /** The requests to close every open Change by, in any window. */
      openChanges: (): ChangeRequest[] => changes.list().map(requestOf),
    },
    reviewWindow: {
      /** Stands in for the review window, which the tests can't run in, or stops. */
      actAs: async (acting: boolean) => {
        inReviewWindow = acting
          ? () => true
          : () => reviewWindow.isThisWindow();
        await showInReviewWindow();
        carryOutRequests();
      },
      /**
       * Hands closing the review window to `close` instead, or back with
       * none. A review window the tests open runs their entry point, and
       * VSCodium exits, ending the run, once that window closes.
       */
      closeWith: (close?: () => void) => {
        closeReviewWindow = close ?? closeWindow;
      },
      /**
       * Has this window hold Changes as the review window does, which the
       * tests can't run in: a Change opened here gets its folders here.
       */
      holdChangesHere: (holds: boolean) => changes.holdChangesHere(holds),
      /** Answers the question of discarding a Comment being written, or with none asks the Reviewer again. */
      answerDiscardQuestion: (discard?: boolean) => {
        discardAnswer = discard;
      },
      /** The questions about discarding a Comment that were asked. */
      discardQuestions: (): readonly string[] => [...discardAsked],
    },
    /**
     * What this window holds for Changes, for the tests: the names of those
     * with Findings, the titles of overviews and Assistants, and the count
     * of review threads.
     */
    held: () => ({
      findings: findings.changeNames(),
      timelines: timelines.panels().map((panel) => panel.title),
      assistants: assistants.overviews().map((overview) => overview.title),
      threads: review.threads().length,
    }),
    /** Shortens how long an automatic check waits after the last; without `ms`, back to the default. */
    refreshGapMs: (ms: number = minimumGapMs) => {
      refreshGate.gapMs = ms;
    },
    /** Whether a check of any pull request Change is running, which a test waits out. */
    refreshRunning: () => refreshGate.anyRunning(),
    /** Stands in for the window regaining focus, which a test can't give it. */
    windowFocused: () => fetchUpdatesOfShown(),
    /** Every Change shown the way a review starts, oldest first, by name. */
    shownChanges: (): readonly string[] => [...shownChanges],
    /** A stand-in for the Extensions view's search. */
    languages: {
      searchWith: (search?: (query: string) => void) =>
        languageOffer.searchWith(search),
    },
    /** Stands in for workspace trust and for showing Workspace Trust; tests run with trust off. */
    trust: {
      forTests: (stand: Parameters<ReviewWindowTrust["forTests"]>[0]) =>
        trust.forTests(stand),
      hint: () => trust.hint(),
    },
    /** Hands information notifications to `answer`, which picks a button or none, or back to the Reviewer. */
    answerNotificationsWith: (
      answer?: (message: string, actions: string[]) => string | undefined
    ) => {
      notify = answer
        ? async (message, ...actions) => answer(message, actions)
        : showInformation;
    },
    /** Shortens how long a request to GitHub waits for an answer, so a test needn't wait a real half minute; without `ms`, back to the default. */
    requestTimeoutMs: (ms: number = REQUEST_TIMEOUT_MS) => {
      github.requestTimeoutMs = ms;
    },
    /** Hands error notifications to `answer`, which picks a button or none, or back to the Reviewer. */
    answerErrorsWith: (
      answer?: (
        message: string,
        actions: string[]
      ) => string | undefined | Promise<string | undefined>
    ) => {
      reportProblem = answer
        ? async (message, ...actions) => answer(message, actions)
        : showError;
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
  const refs = parseRefs(
    await git(
      repository,
      "for-each-ref",
      "--sort=-committerdate",
      `--format=${refFormat}`,
      "refs/heads",
      "refs/remotes",
      "refs/tags"
    ).catch(() => "")
  );
  const base = await pickRef(
    "Base: the branch, tag or commit the Change starts from",
    baseChoices(refs, mainOf(refs))
  );
  if (!base) return;
  const current = await git(repository, "symbolic-ref", "--short", "-q", "HEAD")
    .then((name) => name || undefined)
    .catch(() => undefined);
  const head = await pickRef(
    "Head: the branch, tag or commit to review",
    headChoices(refs, current)
  );
  if (!head) return;
  // Worktrees take a while to make; an empty or unknown range is said first.
  let ahead: number;
  try {
    ahead = Number(
      await git(repository, "rev-list", "--count", `${base}..${head}`)
    );
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Couldn't open ${base}..${head}: ${messageOf(err)}`
    );
    return;
  }
  if (ahead === 0) {
    void vscode.window.showWarningMessage(
      `${head} has no commits that ${base} doesn't, so there's nothing to review.`
    );
    return;
  }
  return { repository, base, head };
}

/** Asks for a ref from the repository's, or any commit by name. */
async function pickRef(
  prompt: string,
  refs: Ref[]
): Promise<string | undefined> {
  const other = "Another Commit…";
  const kinds = { branch: "branch", remote: "remote branch", tag: "tag" };
  const picked = await vscode.window.showQuickPick(
    [
      ...refs.map((ref) => ({
        label: ref.name,
        description: kinds[ref.kind],
        detail: ref.subject,
      })),
      { label: other, description: "a commit ID or any revision" },
    ],
    { title: "Open Commit Range", placeHolder: prompt, matchOnDetail: true }
  );
  if (!picked) return;
  if (picked.label !== other) return picked.label;
  return (
    (await vscode.window.showInputBox({
      title: "Open Commit Range",
      prompt,
    })) || undefined
  );
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

/**
 * The only Change of these, or one the Reviewer picks; `none` says why there
 * is none, offering `way` to one.
 */
async function pickChange(
  open: Change[],
  title: string,
  none: string,
  way?: vscode.Command
): Promise<Change | undefined> {
  if (open.length === 0) {
    void vscode.window
      .showInformationMessage(none, ...(way ? [way.title] : []))
      .then((chosen) => {
        if (way && chosen === way.title)
          void vscode.commands.executeCommand(way.command);
      });
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
