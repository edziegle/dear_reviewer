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
  serveGitHub,
  setToken,
  type FakePullRequest,
} from "../github";
import { eventually } from "../reviewer";

const viewer = { login: "reviewer", token: "test-token" };
const settingKeys = ["githubApiUrl", "repositories", "localClones"];
const hour = 60 * 60_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

// Dependabot asks for a review the same way a person does, so these all sit
// in the Inbox's Awaiting my review group; what tells them apart is that
// GitHub says a Bot opened them.
//
// The fixtures write `dependabot[bot]`, the login github.com shows, and the
// fake answers the `Bot` login GraphQL gives, which leaves the suffix off,
// as GitHub does.
/** Dependabot's own commit of a patch bump, signed by GitHub as they are. */
const bumped = (
  sha: string,
  message: string,
  more: {
    author?: string;
    authorLogin?: string;
    verified?: boolean;
    signedByGitHub?: boolean;
  } = {}
) => ({
  type: "commit" as const,
  sha,
  message,
  author: "dependabot[bot]",
  authorLogin: "dependabot[bot]",
  verified: true,
  signedByGitHub: true,
  date: ago(6 * 24 * hour),
  ...more,
});

const patchBump = `chore(deps): bump fast-uri from 3.1.8 to 3.1.9

Bumps [fast-uri](https://github.com/fastify/fast-uri) from 3.1.8 to 3.1.9.

---
updated-dependencies:
- dependency-name: fast-uri
  dependency-version: 3.1.9
  dependency-type: indirect
...`;

const majorBump = `chore(deps): bump left-pad from 1.0.0 to 2.0.0

Bumps [left-pad](https://github.com/left-pad/left-pad) from 1.0.0 to 2.0.0.

---
updated-dependencies:
- dependency-name: left-pad
  dependency-version: 2.0.0
  dependency-type: direct:production
  update-type: version-update:semver-major
...`;

const update: FakePullRequest = {
  repository: "acme/deps",
  number: 81,
  title: "chore(deps): bump fast-uri from 3.1.8 to 3.1.9",
  author: "dependabot[bot]",
  authorIsBot: true,
  reviewRequested: ["reviewer"],
  reviewRequestedAt: ago(6 * 24 * hour),
  headSha: "aaaa",
  timeline: [bumped("aaaa", patchBump)],
};
const olderUpdate: FakePullRequest = {
  repository: "acme/deps",
  number: 82,
  title: "chore(deps): bump left-pad from 1.0.0 to 2.0.0",
  author: "dependabot[bot]",
  authorIsBot: true,
  reviewRequested: ["reviewer"],
  reviewRequestedAt: ago(9 * 24 * hour),
  headSha: "bbbb",
  timeline: [bumped("bbbb", majorBump)],
};
/** A person's account whose login is Dependabot's: GitHub calls it a User. */
const impostor: FakePullRequest = {
  repository: "acme/deps",
  number: 83,
  title: "Not really from a bot",
  author: "dependabot[bot]",
  reviewRequested: ["reviewer"],
  reviewRequestedAt: ago(3 * hour),
  headSha: "cccc",
};
const fromAPerson: FakePullRequest = {
  repository: "acme/deps",
  number: 84,
  title: "Retry failed webhooks",
  author: "alice",
  reviewRequested: ["reviewer"],
  reviewRequestedAt: ago(2 * hour),
  headSha: "dddd",
};
/** Dependabot's, but asking nobody: no Team request and no reviewer named. */
const unasked: FakePullRequest = {
  repository: "acme/deps",
  number: 85,
  title: "chore(deps): bump nothing anyone waits for",
  author: "dependabot[bot]",
  authorIsBot: true,
  headSha: "eeee",
};
const idOf = (p: FakePullRequest) => `pull request ${p.repository}#${p.number}`;

const names = (list?: DashboardState["waiting"]) => list?.map((w) => w.name);

// Dependency updates (ADR 0051) are listed apart from Waiting on you, which
// keeps Waiting on you to the pull requests people are waiting on.
describe("Dashboard: Dependency updates", () => {
  const found = new Map<string, unknown>();

  async function serve(...pullRequests: FakePullRequest[]): Promise<void> {
    await serveGitHub({
      viewer,
      pullRequests: pullRequests.map((p) => structuredClone(p)),
    });
    await refreshInbox();
  }

  before(async () => {
    const config = vscode.workspace.getConfiguration("dearReviewer");
    for (const key of settingKeys)
      found.set(key, config.inspect(key)?.globalValue);
    await configure({ repositories: ["acme/deps"] });
    await setToken(viewer.token);
    await showDashboard();
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

  it("lists Dependabot's apart from Waiting on you, out of its count, longest wait first", async () => {
    await serve(update, olderUpdate, fromAPerson);

    await eventually(async () => {
      const d = await renderedDashboard();
      assert.deepStrictEqual(names(d.waiting), ["acme/deps #84"]);
      assert.strictEqual(
        d.facts,
        "1 waiting on you · oldest 2 hours",
        "a Dependency update is in neither the count nor the oldest figure"
      );
      assert.deepStrictEqual(names(d.dependencyUpdates), [
        "acme/deps #82",
        "acme/deps #81",
      ]);
      assert.deepStrictEqual(
        d.dependencyUpdates?.map((w) => w.waited),
        ["9 days", "6 days"]
      );
      assert.deepStrictEqual(
        d.dependencyUpdates?.map((w) => w.update),
        ["major", "patch"],
        "each row says how far its versions moved"
      );
    });
  });

  it("says the update type is unknown when no verified commit of Dependabot's gives one", async () => {
    // The block claims a patch, but the commit is someone else's and
    // unsigned, so its message is never read (ADR 0051).
    const forged: FakePullRequest = {
      ...structuredClone(update),
      number: 86,
      timeline: [
        bumped("ffff", patchBump, { author: "alice", verified: false }),
      ],
    };

    await serve(forged);

    await eventually(async () => {
      const d = await renderedDashboard();
      assert.deepStrictEqual(
        d.dependencyUpdates?.map((w) => [w.name, w.update]),
        [["acme/deps #86", "unknown"]]
      );
    });
  });

  it("reads no metadata from a commit the pusher signed themselves, whatever name it carries", async () => {
    // The forgery the brief names, as it can be made: a commit claiming
    // Dependabot's git name and author account, carrying a block that says
    // patch, signed with a key of the pusher's own that GitHub reports as
    // valid. Only GitHub's own key counts, so this is read for nothing.
    const forged: FakePullRequest = {
      ...structuredClone(update),
      number: 87,
      timeline: [
        bumped("9999", patchBump, { verified: true, signedByGitHub: false }),
      ],
    };

    await serve(forged);

    await eventually(async () => {
      const d = await renderedDashboard();
      assert.deepStrictEqual(
        d.dependencyUpdates?.map((w) => [w.name, w.update]),
        [["acme/deps #87", "unknown"]]
      );
    });
  });

  it("reads no metadata from a commit GitHub signed whose author is someone else", async () => {
    // GitHub signs what it commits for anyone, so its key alone isn't
    // enough: the author it resolved has to be Dependabot's account. The
    // commit is still counted as the author's.
    const forged: FakePullRequest = {
      ...structuredClone(update),
      number: 88,
      timeline: [
        bumped("8888", patchBump, {
          author: "mallory",
          authorLogin: "mallory",
          verified: true,
          signedByGitHub: true,
        }),
      ],
    };

    await serve(forged);

    await eventually(async () => {
      const d = await renderedDashboard();
      assert.deepStrictEqual(
        d.dependencyUpdates?.map((w) => [w.name, w.update]),
        [["acme/deps #88", "unknown"]]
      );
    });
  });

  it("keeps a pull request of a person's account in Waiting on you, whatever login it goes by", async () => {
    await serve(impostor, fromAPerson);

    await eventually(async () => {
      const d = await renderedDashboard();
      assert.deepStrictEqual(names(d.waiting), [
        "acme/deps #83",
        "acme/deps #84",
      ]);
      assert.deepStrictEqual(names(d.dependencyUpdates), []);
    });
  });

  it("leaves out one that asks nobody for a review", async () => {
    await serve(unasked, fromAPerson);

    await eventually(async () => {
      const d = await renderedDashboard();
      assert.deepStrictEqual(names(d.waiting), ["acme/deps #84"]);
      assert.deepStrictEqual(names(d.dependencyUpdates), []);
    });
  });

  it("offers one as the next step only once nothing in Waiting on you is left to open", async () => {
    await serve(update, fromAPerson);
    await eventually(async () => {
      const d = await renderedDashboard();
      assert.strictEqual(
        d.next?.id,
        idOf(fromAPerson),
        "the person's pull request comes first, though it has waited less"
      );
    });

    await serve(update, olderUpdate);

    await eventually(async () => {
      const d = await renderedDashboard();
      assert.deepStrictEqual(d.next, {
        kind: "open",
        id: idOf(olderUpdate),
        label: "Review acme/deps #82",
        place: "acme/deps #82 has waited longest on you: 9 days",
      });
      assert.strictEqual(d.facts, "Nothing waiting on you");
    });
  });

  it("sets one aside and brings it back to Dependency updates, not to Waiting on you", async () => {
    await serve(update, fromAPerson);
    await eventually(async () =>
      assert.deepStrictEqual(names((await renderedDashboard()).ignored), [])
    );

    await clickDashboard({ type: "ignore", id: idOf(update) });

    await eventually(async () => {
      const d = await renderedDashboard();
      assert.deepStrictEqual(names(d.dependencyUpdates), []);
      assert.deepStrictEqual(names(d.ignored), ["acme/deps #81"]);
      assert.deepStrictEqual(
        d.ignored?.map((w) => w.waited),
        ["6 days"],
        "it keeps the wait it had"
      );
      assert.deepStrictEqual(names(d.waiting), ["acme/deps #84"]);
    });

    await clickDashboard({ type: "restore", id: idOf(update) });

    await eventually(async () => {
      const d = await renderedDashboard();
      assert.deepStrictEqual(names(d.dependencyUpdates), ["acme/deps #81"]);
      assert.deepStrictEqual(names(d.ignored), []);
      assert.deepStrictEqual(names(d.waiting), ["acme/deps #84"]);
    });
  });
});
