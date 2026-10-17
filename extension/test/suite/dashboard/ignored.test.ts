import * as assert from "assert";
import * as vscode from "vscode";
import {
  clickDashboard,
  renderedDashboard,
  showDashboard,
  type DashboardState,
} from "../dashboard";
import {
  configure,
  refreshInbox,
  requestsToGitHub,
  serveGitHub,
  setToken,
  type FakePullRequest,
} from "../github";
import { eventually } from "../reviewer";

const viewer = { login: "reviewer", token: "test-token" };
const settingKeys = ["githubApiUrl", "repositories", "localClones"];
const hour = 60 * 60_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const fast: FakePullRequest = {
  repository: "acme/ignore",
  number: 51,
  title: "Cache the token",
  author: "bob",
  reviewRequested: ["reviewer"],
  reviewRequestedAt: ago(6 * 24 * hour),
  headSha: "aaaa",
};
const slow: FakePullRequest = {
  repository: "acme/ignore",
  number: 52,
  title: "Retry failed webhooks",
  author: "alice",
  reviewRequested: ["reviewer"],
  reviewRequestedAt: ago(2 * hour),
  headSha: "bbbb",
};
const idOf = (p: FakePullRequest) => `pull request ${p.repository}#${p.number}`;

// A pull request the Reviewer never will review can be set aside in Waiting
// on you, and brought back from the Ignored list under it.
describe("Dashboard: ignoring a pull request waiting on the Reviewer", () => {
  const found = new Map<string, unknown>();

  async function serve(...pullRequests: FakePullRequest[]): Promise<void> {
    await serveGitHub({
      viewer,
      pullRequests: pullRequests.map((p) => structuredClone(p)),
    });
    await refreshInbox();
  }

  const waitingNames = (d: DashboardState) => d.waiting?.map((w) => w.name);
  const ignoredNames = (d: DashboardState) => d.ignored?.map((w) => w.name);

  before(async () => {
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      found.set(key, config.inspect(key)?.globalValue);
    await configure({ repositories: ["acme/ignore"] });
    await setToken(viewer.token);
    await serve(fast, slow);
    await showDashboard();
  });

  afterEach(async () => {
    // What the Reviewer set aside outlasts a test, so each puts it back.
    for (const p of [fast, slow])
      await clickDashboard({ type: "restore", id: idOf(p) });
  });

  after(async () => {
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      await config.update(
        key,
        found.get(key),
        vscode.ConfigurationTarget.Global
      );
  });

  it("takes it out of Waiting on you, its count and its oldest figure, and lists it as ignored with the wait it had, without asking GitHub", async () => {
    await eventually(async () => {
      const d = await renderedDashboard();
      assert.strictEqual(d.facts, "2 waiting on you · oldest 6 days");
      assert.deepStrictEqual(ignoredNames(d), []);
    });
    const asked = (await requestsToGitHub()).length;

    await clickDashboard({ type: "ignore", id: idOf(fast) });

    await eventually(async () => {
      const d = await renderedDashboard();
      assert.deepStrictEqual(waitingNames(d), ["acme/ignore #52"]);
      assert.strictEqual(d.facts, "1 waiting on you · oldest 2 hours");
      assert.deepStrictEqual(
        d.ignored?.map((w) => [w.name, w.waited]),
        [["acme/ignore #51", "6 days"]]
      );
      assert.strictEqual(
        d.next?.id,
        idOf(slow),
        "the next step skips what was set aside"
      );
    });
    assert.strictEqual((await requestsToGitHub()).length, asked);
  });

  it("keeps it ignored through new commits and a new review request", async () => {
    await clickDashboard({ type: "ignore", id: idOf(fast) });
    await eventually(async () =>
      assert.deepStrictEqual(ignoredNames(await renderedDashboard()), [
        "acme/ignore #51",
      ])
    );

    await serve(
      { ...fast, headSha: "cccc", reviewRequestedAt: ago(5 * 60_000) },
      slow
    );

    await eventually(async () => {
      const d = await renderedDashboard();
      assert.deepStrictEqual(waitingNames(d), ["acme/ignore #52"]);
      assert.deepStrictEqual(ignoredNames(d), ["acme/ignore #51"]);
    });
    await serve(fast, slow);
  });

  it("forgets it once it is merged or closed, so it waits on the Reviewer again if it reopens", async () => {
    await clickDashboard({ type: "ignore", id: idOf(fast) });
    await eventually(async () =>
      assert.deepStrictEqual(ignoredNames(await renderedDashboard()), [
        "acme/ignore #51",
      ])
    );

    await serve({ ...fast, state: "MERGED" }, slow);
    await eventually(async () => {
      const d = await renderedDashboard();
      assert.deepStrictEqual(ignoredNames(d), []);
      assert.deepStrictEqual(waitingNames(d), ["acme/ignore #52"]);
    });

    await serve(fast, slow);
    await eventually(async () => {
      const d = await renderedDashboard();
      assert.deepStrictEqual(waitingNames(d), [
        "acme/ignore #51",
        "acme/ignore #52",
      ]);
      assert.deepStrictEqual(ignoredNames(d), []);
    });
  });
});
