import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
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
import { reviewWindowReportFile } from "../reviewWindowProbe";

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

    let report: {
      folders: { name: string; path: string }[];
      tab?: string;
      files: { original?: string; modified?: string }[];
    } = { folders: [], files: [] };
    // The probe rewrites its report as the diff's editors open one by one.
    await eventually(() => {
      report = JSON.parse(fs.readFileSync(reviewWindowReportFile(), "utf8"));
      assert.strictEqual(report.files.length, 4);
    }, 90_000);

    assert.strictEqual(global.dearReviewerHostState, hostState);
    assert.deepStrictEqual(workspaceFolders(), before);

    const [base, head] = worktreesOf(repo.path).slice(1);
    assert.deepStrictEqual(
      [base, head].map((w) => gitIn(w.path, "rev-parse", "HEAD")),
      [repo.commits.initial, repo.commits.renamed]
    );
    assert.deepStrictEqual(report.folders.slice(1), [
      { name: `${name} base ${short(repo.commits.initial)}`, path: base.path },
      { name: `${name} head ${short(repo.commits.renamed)}`, path: head.path },
    ]);
    assert.ok(
      report.tab?.includes(
        `${short(repo.commits.initial)}..${short(repo.commits.renamed)}`
      ),
      `review window shows the Change's diff, not "${report.tab}"`
    );

    await closeChange(request);

    assert.deepStrictEqual(
      worktreesOf(repo.path).map((w) => w.path),
      [repo.path]
    );
    for (const w of [base, head]) assert.ok(!fs.existsSync(w.path));
  });
});
