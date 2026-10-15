import * as assert from "assert";
import * as fs from "fs";
import * as vscode from "vscode";
import { configure, setToken } from "../../github";
import { eventually, workspaceFolders, worktreesOf } from "../../reviewer";
import { pickUpAfterReload } from "../handoff";

const viewer = { login: "reviewer", token: "test-token" };
const settingKeys = ["githubApiUrl", "repositories", "localClones"];

// A second launch of the workspace the first lifecycle launch left with a
// local Change whose worktrees it deleted, and a pull request's Change whose
// pull request the fake GitHub now reports merged. The token, kept in
// memory, did not survive.
describe("Changes that ended while the window was closed", () => {
  const { before, deleted, merged } = pickUpAfterReload();
  const paths = () => workspaceFolders().map((f) => f.path);

  after(async () => {
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      await config.update(key, undefined, vscode.ConfigurationTarget.Global);
  });

  it("closes, at startup, a Change whose worktrees were deleted, keeping the window's first folder", async () => {
    await eventually(() =>
      assert.ok(
        deleted.folders.every((f) => !paths().includes(f)),
        `${deleted.folders.join(", ")} left the window: ${paths().join(", ")}`
      )
    );
    assert.deepStrictEqual(workspaceFolders()[0], before[0]);
    // The Change's folders leave the window before git's records are pruned.
    await eventually(() =>
      assert.deepStrictEqual(
        worktreesOf(deleted.change.repository).map((w) => w.path),
        [deleted.change.repository]
      )
    );
    assert.ok(
      merged.folders.every((f) => paths().includes(f)),
      "the merged pull request's Change waits until GitHub says it was merged"
    );
  });

  it("removes a merged pull request's Change once the Reviewer signs in", async () => {
    await configure({ repositories: [merged.change.pullRequest!.repository] });

    await setToken(viewer.token);

    await eventually(() => assert.deepStrictEqual(workspaceFolders(), before));
    // The Change's folders leave the window before git's records are pruned.
    await eventually(() =>
      assert.deepStrictEqual(
        worktreesOf(merged.change.repository).map((w) => w.path),
        [merged.change.repository]
      )
    );
    for (const folder of merged.folders)
      assert.ok(!fs.existsSync(folder), `${folder} was deleted`);
  });
});
