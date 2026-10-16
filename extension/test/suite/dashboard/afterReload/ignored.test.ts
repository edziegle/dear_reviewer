import * as assert from "assert";
import * as vscode from "vscode";
import {
  clickDashboard,
  renderedDashboard,
  showDashboard,
} from "../../dashboard";
import { configure, refreshInbox, setToken } from "../../github";
import { eventually } from "../../reviewer";

const viewer = { login: "reviewer", token: "test-token" };
const settingKeys = ["githubApiUrl", "repositories", "localClones"];

// A second launch of the workspace the first dashboard launch left with a
// pull request ignored. The fake GitHub still serves both pull requests; the
// token, kept in memory, did not survive.
describe("Dashboard after a reload", () => {
  before(async () => {
    await configure({ repositories: ["acme/reload"] });
    await setToken(viewer.token);
    await refreshInbox();
    await showDashboard();
  });

  after(async () => {
    // Whatever a failed test left ignored must not reach the suites after it.
    await clickDashboard({
      type: "restore",
      id: "pull request acme/reload#61",
    });
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      await config.update(key, undefined, vscode.ConfigurationTarget.Global);
  });

  it("still has the pull request ignored, until the Reviewer restores it", async () => {
    await eventually(async () => {
      const dashboard = await renderedDashboard();
      assert.deepStrictEqual(
        dashboard.waiting?.map((w) => w.name),
        ["acme/reload #62"]
      );
      assert.deepStrictEqual(
        dashboard.ignored?.map((w) => w.name),
        ["acme/reload #61"]
      );
      assert.strictEqual(dashboard.facts?.startsWith("1 waiting on you"), true);
    });

    await clickDashboard({
      type: "restore",
      id: "pull request acme/reload#61",
    });

    await eventually(async () => {
      const dashboard = await renderedDashboard();
      assert.deepStrictEqual(
        dashboard.waiting?.map((w) => w.name),
        ["acme/reload #61", "acme/reload #62"]
      );
      assert.deepStrictEqual(dashboard.ignored, []);
    });
  });
});
