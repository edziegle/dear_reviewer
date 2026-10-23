import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { codeColumnTab } from "../changeFiles";
import { buildFixtureRepo } from "../fixtures";
import {
  activeTabLabel,
  eventually,
  multiDiffFiles,
  closeChange,
  foldersAddedSince,
  openChange,
  short,
  workspaceFolders,
} from "../reviewer";

describe("The Change's multi-file diff", () => {
  it("opens with the Change's overview alone, and the diff only when asked, with the overview beside it", async () => {
    const repo = buildFixtureRepo("diff");
    const request = {
      repository: repo.path,
      base: repo.commits.initial,
      head: repo.commits.renamed,
    };
    const before = workspaceFolders();

    await openChange(request);
    try {
      const [base, head] = foldersAddedSince(before);
      const title = `${path.basename(repo.path)} ${short(repo.commits.initial)}..${short(repo.commits.renamed)}`;
      await eventually(() => assert.strictEqual(activeTabLabel(), title));
      assert.deepStrictEqual(multiDiffFiles(), [], "no diff until asked");

      await vscode.commands.executeCommand(
        "dearReviewer.openAllChanges",
        request
      );

      await eventually(() =>
        assert.match(codeColumnTab()?.label ?? "", /· all changes \(4 files\)$/)
      );
      await eventually(() => {
        const overviewGroup = vscode.window.tabGroups.all.find((group) =>
          group.tabs.some((tab) => tab.label === title)
        );
        assert.ok(
          overviewGroup &&
            !overviewGroup.tabs.some((tab) => tab === codeColumnTab()),
          "the overview stays beside the diff"
        );
      });
      await eventually(() =>
        assert.deepStrictEqual(multiDiffFiles(), [
          { original: undefined, modified: path.join(head.path, "added.py") },
          {
            original: path.join(base.path, "main.py"),
            modified: path.join(head.path, "main.py"),
          },
          {
            original: path.join(base.path, "obsolete.py"),
            modified: undefined,
          },
          {
            original: path.join(base.path, "util.py"),
            modified: path.join(head.path, "util.py"),
          },
        ])
      );

      await vscode.commands.executeCommand(
        "dearReviewer.openAllChanges",
        request
      );
      await eventually(() =>
        assert.deepStrictEqual(
          vscode.window.tabGroups.all
            .flatMap((group) => group.tabs)
            .filter((tab) => / · all changes \(4 files\)$/.test(tab.label))
            .map((tab) => tab === codeColumnTab()),
          [true],
          "asked again, the diff in the code column is shown, not opened again"
        )
      );
    } finally {
      await closeChange(request);
    }
  });
});
