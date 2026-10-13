import * as assert from "assert";
import * as path from "path";
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
  it("shows added, modified and deleted files, with the missing side absent", async () => {
    const repo = buildFixtureRepo("diff");
    const request = {
      repository: repo.path,
      base: repo.commits.initial,
      head: repo.commits.renamed,
    };
    const before = workspaceFolders();

    await openChange(request);

    const [base, head] = foldersAddedSince(before);
    const label = activeTabLabel();
    assert.ok(
      label?.includes(
        `${short(repo.commits.initial)}..${short(repo.commits.renamed)}`
      ),
      `diff title "${label}" names the Change`
    );
    await eventually(() => assert.deepStrictEqual(multiDiffFiles(), [
      { original: undefined, modified: path.join(head.path, "added.py") },
      {
        original: path.join(base.path, "main.py"),
        modified: path.join(head.path, "main.py"),
      },
      { original: path.join(base.path, "obsolete.py"), modified: undefined },
      {
        original: path.join(base.path, "util.py"),
        modified: path.join(head.path, "util.py"),
      },
    ]));

    await closeChange(request);
  });
});
