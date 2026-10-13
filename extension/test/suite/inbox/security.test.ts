import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { eventually } from "../reviewer";
import {
  configure,
  fakeGitHubUrl,
  inbox,
  refreshInbox,
  requestsToGitHub,
  serveGitHub,
  setToken,
} from "../github";

const viewer = { login: "reviewer", token: "test-token" };

/** The fake GitHub under another origin: same server, different host name. */
function otherOrigin(): string {
  return fakeGitHubUrl().replace("127.0.0.1", "localhost");
}

function apiHost(): string {
  return new URL(fakeGitHubUrl()).host;
}

function awaitingMyReview(repository: string, title: string) {
  return {
    repository,
    number: 1,
    title,
    author: "alice",
    reviewRequested: ["reviewer"],
  };
}

describe("Where the GitHub token goes", () => {
  it("ignores a GitHub API base URL set in the workspace's settings", async () => {
    await serveGitHub({
      viewer,
      pullRequests: [awaitingMyReview("acme/web", "In web")],
    });
    await configure({ repositories: ["acme/api"] });
    await setToken(viewer.token);
    const folder = vscode.workspace.workspaceFolders![0].uri.fsPath;
    const settingsFile = path.join(folder, ".vscode", "settings.json");
    const config = () => vscode.workspace.getConfiguration("dearReviewer");
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(
      settingsFile,
      JSON.stringify({
        "dearReviewer.githubApiUrl": otherOrigin(),
        // Shows when VS Code has read the file.
        "dearReviewer.repositories": ["acme/web"],
      })
    );
    try {
      await eventually(() =>
        assert.deepStrictEqual(config().get("repositories"), ["acme/web"])
      );
      await refreshInbox();

      assert.deepStrictEqual(titles(await inbox()), ["In web"]);
      const hosts = (await requestsToGitHub()).map((r) => r.host);
      assert.ok(hosts.length > 0);
      assert.deepStrictEqual(
        hosts.filter((host) => host !== apiHost()),
        [],
        "every request went to the user-level base URL"
      );
    } finally {
      fs.rmSync(path.dirname(settingsFile), { recursive: true, force: true });
      await eventually(() =>
        assert.deepStrictEqual(config().get("repositories"), ["acme/api"])
      );
    }
  });

  it("doesn't send a token saved for one GitHub to another", async () => {
    await serveGitHub({
      viewer,
      pullRequests: [awaitingMyReview("acme/api", "In api")],
    });
    await configure({ repositories: ["acme/api"] });
    await setToken(viewer.token);

    await configure({ repositories: ["acme/api"], apiUrl: otherOrigin() });
    await refreshInbox();

    assert.deepStrictEqual(await inbox(), [], "signed out on the other origin");
    assert.deepStrictEqual(
      (await requestsToGitHub()).filter((r) => r.authorization),
      []
    );

    await configure({ repositories: ["acme/api"] });
    await refreshInbox();

    assert.deepStrictEqual(titles(await inbox()), ["In api"]);
  });

  it("sends no token to a plain-http GitHub API that isn't on this machine", async () => {
    await serveGitHub({
      viewer,
      pullRequests: [awaitingMyReview("acme/api", "In api")],
    });
    // 0.0.0.0 reaches the fake server but isn't a loopback name.
    const insecure = fakeGitHubUrl().replace("127.0.0.1", "0.0.0.0");
    await configure({ repositories: ["acme/api"], apiUrl: insecure });
    await setToken(viewer.token);
    await refreshInbox();

    const groups = await inbox();

    assert.strictEqual(groups.length, 1, JSON.stringify(groups));
    assert.match(groups[0].label, /https/);
    assert.strictEqual(groups[0].icon, "$(error)");
    assert.deepStrictEqual(
      (await requestsToGitHub()).filter((r) => r.authorization),
      []
    );
  });

  it("sends no token with an avatar on another origin", async () => {
    await serveGitHub({
      viewer,
      pullRequests: [awaitingMyReview("acme/api", "In api")],
      avatarOrigin: otherOrigin(),
    });
    await configure({ repositories: ["acme/api"] });
    await setToken(viewer.token);
    await refreshInbox();

    const [awaiting] = await inbox();

    const avatar = awaiting.entries[0].icon;
    assert.ok(avatar && fs.existsSync(avatar), `avatar file: ${avatar}`);
    const avatarRequests = (await requestsToGitHub()).filter((r) =>
      r.path.startsWith("/avatars/")
    );
    assert.deepStrictEqual(
      avatarRequests.map((r) => ({
        host: r.host,
        authorization: r.authorization,
      })),
      [{ host: new URL(otherOrigin()).host, authorization: undefined }]
    );
  });
});

function titles(groups: { entries: { label: string }[] }[]): string[] {
  return groups.flatMap((g) => g.entries.map((e) => e.label));
}
