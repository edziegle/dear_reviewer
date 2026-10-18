import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { findingTurn, replyTurn, scriptClaude } from "../assistant";
import { buildFixtureRepo } from "../fixtures";
import {
  closeChange,
  eventually,
  gitIn,
  openChange,
  short,
  workspaceFolders,
  worktreesOf,
} from "../reviewer";
import {
  inReviewWindow,
  reviewWindowReportFile,
  runInReviewWindow,
  type ReviewWindowReport,
} from "../reviewWindowProbe";

describe("Open Change from a single-folder window", () => {
  it("leaves this window and its extension host alone, and shows the Change in the review window", async () => {
    assert.strictEqual(
      vscode.workspace.workspaceFile,
      undefined,
      "precondition: single-folder window"
    );
    const repo = buildFixtureRepo("single");
    const name = path.basename(repo.path);
    const request = {
      repository: repo.path,
      base: repo.commits.initial,
      head: repo.commits.renamed,
    };
    const before = workspaceFolders();
    // Lives only as long as this extension host does.
    const hostState = { alive: true };
    const global = globalThis as { dearReviewerHostState?: object };
    global.dearReviewerHostState = hostState;

    await openChange(request);

    const overview = `${name} ${short(repo.commits.initial)}..${short(repo.commits.renamed)}`;
    let report: {
      folders: { name: string; path: string }[];
      tab?: string;
      tabs: string[];
      files: { original?: string; modified?: string }[];
      closed: number;
    } = { folders: [], tabs: [], files: [], closed: 0 };
    // The probe rewrites its report as the review window settles.
    await eventually(() => {
      report = JSON.parse(fs.readFileSync(reviewWindowReportFile(), "utf8"));
      assert.strictEqual(report.tab, overview);
    }, 90_000);

    assert.strictEqual(global.dearReviewerHostState, hostState);
    assert.deepStrictEqual(workspaceFolders(), before);

    const [base, head] = worktreesOf(repo.path).slice(1);
    assert.deepStrictEqual(
      [base, head].map((w) => gitIn(w.path, "rev-parse", "HEAD")),
      [repo.commits.initial, repo.commits.renamed]
    );
    // Trusting the first folder once trusts every Change opened later.
    for (const worktree of [base, head])
      assert.ok(
        worktree.path.startsWith(report.folders[0].path + path.sep),
        `${worktree.path} is in the first folder, ${report.folders[0].path}`
      );
    assert.deepStrictEqual(report.folders.slice(1), [
      { name: `${name} base ${short(repo.commits.initial)}`, path: base.path },
      { name: `${name} head ${short(repo.commits.renamed)}`, path: head.path },
    ]);
    assert.deepStrictEqual(
      report.tabs,
      [overview],
      "the review window shows the Change's overview and nothing else"
    );
    assert.deepStrictEqual(
      report.files,
      [],
      "no diff until the Reviewer starts"
    );

    await closeChange(request);

    assert.deepStrictEqual(
      worktreesOf(repo.path).map((w) => w.path),
      [repo.path]
    );
    for (const w of [base, head]) assert.ok(!fs.existsSync(w.path));
    await inReviewWindow((after) =>
      assert.strictEqual(
        after.closed,
        report.closed + 1,
        "closing its last Change closes the review window"
      )
    );
  });

  /**
   * The open Changes still waiting for the review window to show them, from
   * the list every window shares, next to the folder of Changes.
   */
  function pendingInReviewWindow(repository: string): string[] {
    // A worktree is <folder of Changes>/<id>/base.
    const changesDir = path.dirname(
      path.dirname(worktreesOf(repository)[1].path)
    );
    const open = JSON.parse(
      fs.readFileSync(
        path.join(path.dirname(changesDir), "open-changes.json"),
        "utf8"
      )
    ) as { id: string; diffPending?: boolean }[];
    return open.filter((c) => c.diffPending).map((c) => c.id);
  }

  /** Two Changes of one repository, and their titles in the review window. */
  function twoChangesOf(name: string) {
    const repo = buildFixtureRepo(name);
    const first = {
      repository: repo.path,
      base: repo.commits.initial,
      head: repo.commits.renamed,
    };
    const second = {
      repository: repo.path,
      base: repo.commits.renamed,
      head: repo.commits.documented,
    };
    const titleOf = (c: typeof first) =>
      `${path.basename(repo.path)} ${short(c.base)}..${short(c.head)}`;
    return { first, second, titles: [titleOf(first), titleOf(second)] };
  }

  /** The review window shows this Change in front, as a review starts. */
  const inFront = (title: string) => (report: ReviewWindowReport) => {
    assert.deepStrictEqual(report.changeFiles, [title]);
    assert.strictEqual(report.tab, title);
    assert.deepStrictEqual(report.tabs, [title]);
  };

  it("shows the Change behind in the review window once the one in front closes from this window", async () => {
    const { first, second, titles } = twoChangesOf("closedElsewhere");
    await openChange(first);
    await openChange(second);
    await inReviewWindow(inFront(titles[1]));

    await closeChange(second);

    try {
      await inReviewWindow(inFront(titles[0]));
    } finally {
      await closeChange(first);
    }
  });

  it("lets go of what the review window holds for a Change closed from this window, and keeps the others'", async () => {
    const { first, second, titles } = twoChangesOf("letGoElsewhere");
    await scriptClaude(first, {
      turns: [replyTurn("First."), findingTurn(2)],
    });
    await scriptClaude(second, {
      turns: [replyTurn("Second."), findingTurn(3)],
    });
    await openChange(first);
    await openChange(second);
    await inReviewWindow(inFront(titles[1]));
    await runInReviewWindow("dearReviewer.findIssues", first);
    await runInReviewWindow("dearReviewer.findIssues", second);
    // Only the Change in front has an overview.
    await inReviewWindow((report) => {
      assert.deepStrictEqual(
        [...report.held.findings].sort(),
        [...titles].sort()
      );
      assert.deepStrictEqual(
        [...report.held.assistants].sort(),
        [...titles].sort()
      );
      assert.deepStrictEqual(report.held.timelines, [titles[1]]);
    });

    await closeChange(second);

    try {
      // The one behind comes to the front, and the closed one is let go of.
      await inReviewWindow((report) => {
        assert.deepStrictEqual(report.held.findings, [titles[0]]);
        assert.deepStrictEqual(report.held.assistants, [titles[0]]);
        assert.deepStrictEqual(report.held.timelines, [titles[0]]);
      });
    } finally {
      await closeChange(first);
    }
  });

  it("brings a Change opened again from this window to the front of the review window", async () => {
    const { first, second, titles } = twoChangesOf("openedAgain");
    await openChange(first);
    await openChange(second);
    await inReviewWindow(inFront(titles[1]));

    try {
      await openChange(first);
      await inReviewWindow(inFront(titles[0]));

      // Opened again while in front, it stays in front once the review
      // window has taken it in again.
      await openChange(first);
      await eventually(
        () =>
          assert.deepStrictEqual(pendingInReviewWindow(first.repository), []),
        30_000
      );
      await inReviewWindow(inFront(titles[0]));
    } finally {
      await closeChange(second);
      await closeChange(first);
    }
  });

  it("shows only the newer head in the review window when it replaces the Change in front there", async () => {
    const repo = buildFixtureRepo("newerHeadElsewhere");
    const behind = {
      repository: repo.path,
      base: repo.commits.initial,
      head: repo.commits.renamed,
    };
    repo.git("branch", "feature", repo.commits.documented);
    const feature = {
      repository: repo.path,
      base: repo.commits.renamed,
      head: "refs/heads/feature",
    };
    await openChange(behind);
    await openChange(feature);
    let shownBefore = 0;
    await inReviewWindow((report) => {
      assert.strictEqual(report.shown.at(-1), "feature");
      shownBefore = report.shown.length;
    });
    repo.git("branch", "-f", "feature", repo.commits.restructured);

    await openChange(feature);

    try {
      await inReviewWindow((report) =>
        assert.deepStrictEqual(report.shown.slice(shownBefore), ["feature"])
      );
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await inReviewWindow((report) =>
        assert.deepStrictEqual(report.shown.slice(shownBefore), ["feature"])
      );
    } finally {
      await closeChange(feature);
      await closeChange(behind);
    }
  });

  it("shows only the Change left in front in the review window when this window's lifecycle closes several there at once", async () => {
    const repo = buildFixtureRepo("endedElsewhere");
    const titleOf = (c: { base: string; head: string }) =>
      `${path.basename(repo.path)} ${short(c.base)}..${short(c.head)}`;
    const left = {
      repository: repo.path,
      base: repo.commits.initial,
      head: repo.commits.renamed,
    };
    const ending = [
      [repo.commits.renamed, repo.commits.documented],
      [repo.commits.documented, repo.commits.restructured],
    ].map(([base, head]) => ({ repository: repo.path, base, head }));
    await openChange(left);
    const kept = worktreesOf(repo.path).map((w) => w.path);
    for (const change of ending) await openChange(change);
    // The first of them again, in front, so they don't end in the order shown.
    await openChange(ending[0]);
    await eventually(
      () => assert.deepStrictEqual(pendingInReviewWindow(repo.path), []),
      30_000
    );
    let shownBefore = 0;
    await inReviewWindow((report) => {
      inFront(titleOf(ending[0]))(report);
      shownBefore = report.shown.length;
    });
    // Deleted by hand, so the lifecycle finds them over.
    for (const worktree of worktreesOf(repo.path))
      if (!kept.includes(worktree.path))
        fs.rmSync(worktree.path, { recursive: true, force: true });

    await vscode.commands.executeCommand("dearReviewer.refreshInbox");

    try {
      await inReviewWindow((report) => {
        assert.deepStrictEqual(report.shown.slice(shownBefore), [
          titleOf(left),
        ]);
        assert.deepStrictEqual(report.changeFiles, [titleOf(left)]);
      });
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await inReviewWindow((report) =>
        assert.deepStrictEqual(report.shown.slice(shownBefore), [titleOf(left)])
      );
    } finally {
      await closeChange(left);
    }
  });
});
