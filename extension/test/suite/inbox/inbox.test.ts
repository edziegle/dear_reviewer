import * as assert from "assert";
import * as fs from "fs";
import {
  avatarServedFor,
  configure,
  inbox,
  inboxEntry,
  refreshInbox,
  requestsToGitHub,
  serveGitHub,
  forgetToken,
  setToken,
} from "../github";

const viewer = { login: "reviewer", token: "test-token" };

describe("Inbox", () => {
  it("lists pull requests awaiting my review, with the author's avatar, title and repository", async () => {
    await serveGitHub({
      viewer,
      pullRequests: [
        {
          repository: "acme/api",
          number: 7,
          title: "Add rate limiting",
          author: "alice",
          reviewRequested: ["reviewer"],
        },
        {
          repository: "acme/api",
          number: 8,
          title: "Someone else's review",
          author: "bob",
          reviewRequested: ["carol"],
        },
      ],
    });
    await configure({ repositories: ["acme/api"] });
    await setToken(viewer.token);
    await refreshInbox();

    const groups = await inbox();

    const awaiting = groups.find((g) => g.label === "Awaiting my review");
    assert.ok(awaiting, `groups: ${JSON.stringify(groups)}`);
    assert.deepStrictEqual(
      awaiting.entries.map(({ label, description }) => ({
        label,
        description,
      })),
      [{ label: "Add rate limiting", description: "acme/api #7" }]
    );
    const avatar = awaiting.entries[0].icon;
    assert.ok(avatar && fs.existsSync(avatar), `avatar file: ${avatar}`);
    assert.deepStrictEqual(
      fs.readFileSync(avatar),
      await avatarServedFor("alice")
    );
    assert.ok(
      (await requestsToGitHub()).some(
        (r) => r.path === "/graphql" && r.authorization === "Bearer test-token"
      ),
      "the Inbox was fetched with the token"
    );
  });

  it("groups pull requests awaiting my review and ones I authored, across all configured repositories", async () => {
    await serveGitHub({
      viewer,
      pullRequests: [
        {
          repository: "acme/api",
          number: 1,
          title: "Review me in api",
          author: "alice",
          reviewRequested: ["reviewer"],
          updatedAt: "2026-10-01T00:00:00Z",
        },
        {
          repository: "acme/web",
          number: 2,
          title: "Review me in web",
          author: "bob",
          reviewRequested: ["reviewer"],
          updatedAt: "2026-10-03T00:00:00Z",
        },
        {
          repository: "acme/web",
          number: 3,
          title: "My own work",
          author: "reviewer",
        },
        {
          repository: "acme/web",
          number: 4,
          title: "My merged work",
          author: "reviewer",
          state: "MERGED",
        },
        {
          repository: "acme/unlisted",
          number: 5,
          title: "Not in my settings",
          author: "alice",
          reviewRequested: ["reviewer"],
        },
      ],
    });
    await configure({ repositories: ["acme/api", "acme/web"] });
    await setToken(viewer.token);
    await refreshInbox();

    const groups = await inbox();

    assert.deepStrictEqual(
      groups.map((g) => ({
        group: g.label,
        entries: g.entries.map((e) => `${e.label} (${e.description})`),
      })),
      [
        {
          group: "Awaiting my review",
          entries: [
            "Review me in web (acme/web #2)",
            "Review me in api (acme/api #1)",
          ],
        },
        { group: "Authored by me", entries: ["My own work (acme/web #3)"] },
        { group: "Reviewed by me", entries: [] },
      ]
    );
  });

  it("keeps open pull requests I reviewed, and didn't author, in Reviewed by me", async () => {
    const reviewedBy = (author: string, state: "APPROVED" | "PENDING") => [
      { id: `review-${author}-${state}`, author, state, threads: [] },
    ];
    await serveGitHub({
      viewer,
      pullRequests: [
        {
          repository: "acme/api",
          number: 1,
          title: "I approved it",
          author: "alice",
          reviews: reviewedBy("reviewer", "APPROVED"),
          updatedAt: "2026-10-01T00:00:00Z",
        },
        {
          repository: "acme/web",
          number: 2,
          title: "I asked for changes",
          author: "bob",
          reviews: [
            {
              id: "changes",
              author: "reviewer",
              state: "CHANGES_REQUESTED",
              threads: [],
            },
          ],
          updatedAt: "2026-10-03T00:00:00Z",
        },
        {
          repository: "acme/api",
          number: 3,
          title: "Re-requested after my review",
          author: "alice",
          reviewRequested: ["reviewer"],
          reviews: reviewedBy("reviewer", "APPROVED"),
        },
        {
          repository: "acme/api",
          number: 4,
          title: "My own work, which I commented on",
          author: "reviewer",
          reviews: reviewedBy("reviewer", "APPROVED"),
        },
        {
          repository: "acme/api",
          number: 5,
          title: "Merged after my review",
          author: "alice",
          state: "MERGED",
          reviews: reviewedBy("reviewer", "APPROVED"),
        },
        {
          repository: "acme/api",
          number: 6,
          title: "Reviewed by someone else",
          author: "alice",
          reviews: reviewedBy("carol", "APPROVED"),
        },
        {
          repository: "acme/api",
          number: 7,
          title: "My review is still pending",
          author: "alice",
          reviews: reviewedBy("reviewer", "PENDING"),
        },
      ],
    });
    await configure({ repositories: ["acme/api", "acme/web"] });
    await setToken(viewer.token);
    await refreshInbox();

    const groups = await inbox();

    assert.deepStrictEqual(
      groups.map((g) => ({
        group: g.label,
        count: g.description,
        entries: g.entries.map((e) => `${e.label} (${e.description})`),
      })),
      [
        {
          group: "Awaiting my review",
          count: "1",
          entries: ["Re-requested after my review (acme/api #3)"],
        },
        {
          group: "Authored by me",
          count: "1",
          entries: ["My own work, which I commented on (acme/api #4)"],
        },
        {
          group: "Reviewed by me",
          count: "2",
          entries: [
            "I asked for changes (acme/web #2)",
            "I approved it (acme/api #1)",
          ],
        },
      ]
    );
    const reviewed = inboxEntry(groups, "I approved it");
    assert.strictEqual(
      reviewed.command?.command,
      "dearReviewer.openPullRequest",
      "a click opens it as a Change, as from the other groups"
    );
  });

  it("searches each repository for pull requests awaiting my review, authored by me and reviewed by me", async () => {
    await serveGitHub({ viewer, pullRequests: [] });
    await configure({ repositories: ["acme/api", "acme/web"] });
    await setToken(viewer.token);
    await refreshInbox();
    await inbox();

    const searches = (await requestsToGitHub())
      .map(
        (r) =>
          (r.body as { variables?: Record<string, unknown> } | undefined)
            ?.variables ?? {}
      )
      .flatMap((variables) => Object.values(variables))
      .filter((value): value is string => typeof value === "string")
      .filter((value) => value.startsWith("is:pr "));

    assert.strictEqual(searches.length, 6, JSON.stringify(searches));
    for (const repository of ["acme/api", "acme/web"])
      assert.ok(
        searches.includes(
          `is:pr is:open archived:false repo:${repository} reviewed-by:@me -author:@me`
        ),
        JSON.stringify(searches)
      );
  });

  it("shows each pull request's check status", async () => {
    const pr = (
      number: number,
      checks?: "SUCCESS" | "FAILURE" | "ERROR" | "PENDING"
    ) => ({
      repository: "acme/api",
      number,
      title: `PR ${number}`,
      author: "alice",
      reviewRequested: ["reviewer"],
      updatedAt: `2026-10-0${9 - number}T00:00:00Z`,
      checks,
    });
    await serveGitHub({
      viewer,
      pullRequests: [
        pr(1, "SUCCESS"),
        pr(2, "FAILURE"),
        pr(3, "ERROR"),
        pr(4, "PENDING"),
        pr(5),
      ],
    });
    await configure({ repositories: ["acme/api"] });
    await setToken(viewer.token);
    await refreshInbox();

    const [awaiting] = await inbox();

    assert.deepStrictEqual(
      awaiting.entries.map((e) => e.description),
      [
        "acme/api #1 · checks passed",
        "acme/api #2 · checks failed",
        "acme/api #3 · checks failed",
        "acme/api #4 · checks running",
        "acme/api #5",
      ]
    );
  });

  it("picks up new pull requests when the Reviewer refreshes it", async () => {
    const first = {
      repository: "acme/api",
      number: 1,
      title: "First",
      author: "alice",
      reviewRequested: ["reviewer"],
    };
    await serveGitHub({ viewer, pullRequests: [first] });
    await configure({ repositories: ["acme/api"] });
    await setToken(viewer.token);
    await refreshInbox();
    assert.deepStrictEqual(titles(await inbox()), ["First"]);

    await serveGitHub({
      viewer,
      pullRequests: [
        first,
        {
          ...first,
          number: 2,
          title: "Second",
          updatedAt: "2026-10-05T00:00:00Z",
        },
      ],
    });
    assert.deepStrictEqual(
      titles(await inbox()),
      ["First"],
      "unchanged until refreshed"
    );

    await refreshInbox();

    assert.deepStrictEqual(titles(await inbox()), ["Second", "First"]);
  });

  it("reloads when the configured repositories change", async () => {
    await serveGitHub({
      viewer,
      pullRequests: [
        {
          repository: "acme/api",
          number: 1,
          title: "In api",
          author: "alice",
          reviewRequested: ["reviewer"],
        },
        {
          repository: "acme/web",
          number: 2,
          title: "In web",
          author: "alice",
          reviewRequested: ["reviewer"],
        },
      ],
    });
    await configure({ repositories: ["acme/api"] });
    await setToken(viewer.token);
    await refreshInbox();
    assert.deepStrictEqual(titles(await inbox()), ["In api"]);

    await configure({ repositories: ["acme/web"] });

    assert.deepStrictEqual(titles(await inbox()), ["In web"]);
  });

  it("is empty, and asks nothing of GitHub, until the Reviewer signs in", async () => {
    await forgetToken();
    await configure({ repositories: ["acme/api"] });
    await serveGitHub({ viewer, pullRequests: [] });
    await refreshInbox();

    assert.deepStrictEqual(await inbox(), []);
    assert.deepStrictEqual(await requestsToGitHub(), []);
  });

  // VS Code only shows the view's welcome message while the tree is empty.
  it("is empty, and asks nothing of GitHub, until the Reviewer lists repositories", async () => {
    await serveGitHub({ viewer, pullRequests: [] });
    await configure({ repositories: [] });
    await setToken(viewer.token);
    await refreshInbox();

    assert.deepStrictEqual(await inbox(), []);
    assert.deepStrictEqual(await requestsToGitHub(), []);
  });

  it("says so when GitHub rejects the token", async () => {
    await serveGitHub({ viewer, pullRequests: [] });
    await configure({ repositories: ["acme/api"] });
    await setToken("wrong-token");
    await refreshInbox();

    const groups = await inbox();

    assert.strictEqual(groups.length, 1, JSON.stringify(groups));
    assert.match(groups[0].label, /401/);
    assert.strictEqual(groups[0].icon, "$(error)");
    assert.strictEqual(
      groups[0].command?.command,
      "dearReviewer.signIn",
      "a click offers to sign in again"
    );
  });
});

function titles(groups: { entries: { label: string }[] }[]): string[] {
  return groups.flatMap((g) => g.entries.map((e) => e.label));
}
