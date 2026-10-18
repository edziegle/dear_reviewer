import * as assert from "assert";
import * as vscode from "vscode";
import { buildPullRequestFixture } from "../fixtures";
import {
  configure,
  forgetToken,
  inbox,
  inboxEntry,
  openFromInbox,
  refreshInbox,
  serveGitHub,
  setToken,
  type FakePullRequest,
} from "../github";
import { reviewThreads } from "../review";
import {
  catchErrors,
  closeChange,
  eventually,
  openChange,
  releaseErrors,
} from "../reviewer";

const viewer = { login: "reviewer", token: "test-token" };
const settingKeys = ["githubApiUrl", "repositories", "localClones"];

// GitHub unreachable or refusing while pull requests open: the Reviewer hears
// about the Active Change, once, and it waits until something changes.
describe("Review threads that fail to load", () => {
  const fixtures = [31, 32, 33, 34].map((number) => {
    const repository = `acme/failing${number}`;
    const pr = buildPullRequestFixture(`failed${number}`, repository, number);
    const pullRequest: FakePullRequest = {
      repository,
      number,
      title: `Failing ${number}`,
      author: "alice",
      reviewRequested: ["reviewer"],
      files: [{ path: "util.py" }],
      reviews: [
        {
          id: `PRR_${number}`,
          author: "alice",
          state: "COMMENTED",
          submittedAt: "2026-10-02T10:00:00Z",
          threads: [
            {
              id: `PRRT_${number}`,
              path: "util.py",
              side: "RIGHT",
              line: 1,
              comments: [{ id: `PRRC_${number}`, body: `Look at ${number}` }],
            },
          ],
        },
      ],
    };
    const change = {
      repository: pr.clone,
      base: pr.base,
      head: pr.head,
      pullRequest: { repository, number },
    };
    return { pr, pullRequest, change, name: `${repository} #${number}` };
  });
  const [first, second, third, fourth] = fixtures;
  const pullRequests = fixtures.map((f) => f.pullRequest);
  const found = new Map<string, unknown>();
  const down = { viewer, pullRequests, failQueries: ["ReviewThreads"] };
  const up = { viewer, pullRequests };
  let errors: Awaited<ReturnType<typeof catchErrors>>;

  const opened = new Set<(typeof fixtures)[number]>();
  const open = async (fixture: (typeof fixtures)[number]) => {
    opened.add(fixture);
    return openFromInbox(inboxEntry(await inbox(), fixture.pullRequest.title));
  };
  const shownFor = (fixture: (typeof fixtures)[number]) =>
    reviewThreads().then((threads) =>
      threads.filter(
        (t) => t.comments[0].body === `Look at ${fixture.pr.number}`
      )
    );

  before(async () => {
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      found.set(key, config.inspect(key)?.globalValue);
    await serveGitHub(down);
    await configure({ repositories: fixtures.map((f) => f.pr.repository) });
    await config.update(
      "localClones",
      Object.fromEntries(fixtures.map((f) => [f.pr.repository, f.pr.clone])),
      vscode.ConfigurationTarget.Global
    );
    await setToken(viewer.token);
    await refreshInbox();
  });

  beforeEach(async () => {
    errors = await catchErrors();
  });

  afterEach(() => releaseErrors());

  after(async () => {
    for (const fixture of opened) await closeChange(fixture.change);
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      await config.update(
        key,
        found.get(key),
        vscode.ConfigurationTarget.Global
      );
  });

  it("tells the Reviewer about each Active Change once, and nothing again about the ones it stopped", async () => {
    await open(first);
    await eventually(() => assert.strictEqual(errors.length, 1));
    assert.match(errors[0].message, new RegExp(first.name));
    assert.ok(errors[0].actions.includes("Retry"));

    await open(second);
    await open(third);
    await eventually(() => assert.strictEqual(errors.length, 3));
    assert.deepStrictEqual(
      errors.map((e) => fixtures.filter((f) => e.message.includes(f.name))),
      [[first], [second], [third]],
      "each message names only the Change that was active"
    );
  });

  it("tries only the Active Change again, once GitHub answers", async () => {
    await serveGitHub(up);
    await openChange(first.change);
    await eventually(async () =>
      assert.strictEqual((await shownFor(first)).length, 1)
    );
    assert.deepStrictEqual(await shownFor(second), []);
    assert.deepStrictEqual(await shownFor(third), []);
    assert.strictEqual(errors.length, 0);
  });

  it("tries the Active Change again when the sign-in changes", async () => {
    await serveGitHub(down);
    await open(second);
    await eventually(() => assert.strictEqual(errors.length, 1));
    assert.deepStrictEqual(await shownFor(second), []);
    await serveGitHub(up);

    await forgetToken();
    await setToken(viewer.token);

    await eventually(async () =>
      assert.strictEqual((await shownFor(second)).length, 1)
    );
    assert.deepStrictEqual(await shownFor(first), []);
  });

  it("tries the Change again when the Reviewer picks Retry", async () => {
    await serveGitHub(down);
    await releaseErrors();
    errors = await catchErrors(async () => {
      await serveGitHub(up);
      return "Retry";
    });
    await open(fourth);
    await eventually(async () =>
      assert.strictEqual((await shownFor(fourth)).length, 1)
    );
    assert.strictEqual(errors.length, 1);
  });
});
