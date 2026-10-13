import * as assert from "assert";
import * as vscode from "vscode";

describe("Inbox settings", () => {
  it("talks to github.com unless the Reviewer sets another GitHub API base URL", () => {
    const config = vscode.workspace.getConfiguration("dearReviewer");
    assert.strictEqual(
      config.inspect("githubApiUrl")?.defaultValue,
      "https://api.github.com"
    );
    assert.deepStrictEqual(config.inspect("repositories")?.defaultValue, []);
  });
});
