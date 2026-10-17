import * as assert from "assert";
import * as fs from "fs";
import type { FakePullRequest, FakeReview } from "../../fakeGitHub";
import {
  awaitingSearches,
  configure,
  inbox,
  inboxEntry,
  inboxSettled,
  refreshInbox,
  serveGitHub,
  setToken,
} from "../github";

const viewer = { login: "reviewer", token: "test-token" };
const head = "a".repeat(40);
const older = "b".repeat(40);

function mine(
  number: number,
  title: string,
  fields: Partial<FakePullRequest> = {}
): FakePullRequest {
  return {
    repository: "acme/api",
    number,
    title,
    author: "reviewer",
    headSha: head,
    updatedAt: `2026-10-${String(30 - number).padStart(2, "0")}T00:00:00Z`,
    ...fields,
  };
}

function review(
  author: string,
  state: FakeReview["state"],
  commit = head
): FakeReview {
  return {
    id: `review-${author}-${state}-${commit}`,
    author,
    state,
    commit,
    threads: [],
  };
}

async function showInbox(pullRequests: FakePullRequest[]) {
  await serveGitHub({ viewer, pullRequests });
  await configure({ repositories: ["acme/api"] });
  await setToken(viewer.token);
  await refreshInbox();
  const groups = await inbox();
  const authored = groups.find((g) => g.label === "Authored by me");
  assert.ok(authored, JSON.stringify(groups));
  return { groups, authored };
}

describe("Inbox: Authored by me", () => {
  it("marks each of my pull requests with the state that needs me, or that it is ready to merge", async () => {
    const { authored } = await showInbox([
      mine(1, "Failing", { checks: "FAILURE" }),
      mine(2, "Conflicting", { mergeable: "CONFLICTING" }),
      mine(3, "Changes wanted", {
        reviews: [review("alice", "CHANGES_REQUESTED", older)],
      }),
      mine(4, "Commented on", { reviews: [review("alice", "COMMENTED")] }),
      mine(5, "Approved", {
        reviewDecision: "APPROVED",
        checks: "SUCCESS",
        reviews: [review("alice", "APPROVED")],
      }),
      mine(6, "Approved, no rules", { reviews: [review("alice", "APPROVED")] }),
      mine(7, "Waiting"),
    ]);

    assert.deepStrictEqual(
      authored.entries.map(({ label, description, icon, iconColor }) => ({
        label,
        description,
        icon,
        iconColor,
      })),
      [
        {
          label: "Failing",
          description: "acme/api #1 · checks failed",
          icon: "$(error)",
          iconColor: "testing.iconFailed",
        },
        {
          label: "Conflicting",
          description: "acme/api #2 · merge conflicts",
          icon: "$(git-merge)",
          iconColor: "list.errorForeground",
        },
        {
          label: "Changes wanted",
          description: "acme/api #3 · changes requested",
          icon: "$(request-changes)",
          iconColor: "list.warningForeground",
        },
        {
          label: "Commented on",
          description: "acme/api #4 · commented",
          icon: "$(comment)",
          iconColor: "editorInfo.foreground",
        },
        {
          label: "Approved",
          description: "acme/api #5 · checks passed · ready to merge",
          icon: "$(pass-filled)",
          iconColor: "testing.iconPassed",
        },
        {
          label: "Approved, no rules",
          description: "acme/api #6 · ready to merge",
          icon: "$(pass-filled)",
          iconColor: "testing.iconPassed",
        },
        {
          label: "Waiting",
          description: "acme/api #7",
          icon: "$(git-pull-request)",
          iconColor: undefined,
        },
      ]
    );
  });

  it("shows the first state that applies, and names them all", async () => {
    const { groups } = await showInbox([
      mine(1, "Everything at once", {
        checks: "FAILURE",
        reviews: [
          review("alice", "CHANGES_REQUESTED"),
          review("bob", "COMMENTED"),
        ],
      }),
    ]);

    const entry = inboxEntry(groups, "Everything at once");
    assert.strictEqual(entry.icon, "$(error)");
    assert.strictEqual(
      entry.description,
      "acme/api #1 · checks failed · changes requested · commented"
    );
    for (const named of [
      "Checks failed",
      "Changes requested by alice",
      "Commented on the latest commit by bob",
    ])
      assert.ok(entry.tooltip?.includes(named), `${named} in ${entry.tooltip}`);
  });

  it("counts only reviewers' latest submitted reviews, and comments only at the current head", async () => {
    const { authored } = await showInbox([
      mine(1, "Commented before my push", {
        reviews: [review("alice", "COMMENTED", older)],
      }),
      mine(2, "Approved after asking for changes", {
        reviews: [
          review("alice", "CHANGES_REQUESTED", older),
          review("alice", "APPROVED"),
        ],
      }),
      mine(3, "My own comment", { reviews: [review("reviewer", "COMMENTED")] }),
      mine(4, "Pending approval", { reviews: [review("alice", "PENDING")] }),
    ]);

    assert.deepStrictEqual(
      authored.entries.map((e) => `${e.label}: ${e.icon}`),
      [
        "Commented before my push: $(git-pull-request)",
        "Approved after asking for changes: $(pass-filled)",
        "My own comment: $(git-pull-request)",
        "Pending approval: $(git-pull-request)",
      ]
    );
  });

  it("leaves out a reviewer whose review I requested again, until they review", async () => {
    const { authored } = await showInbox([
      mine(1, "Asked again", {
        reviewRequested: ["alice"],
        reviews: [review("alice", "COMMENTED")],
      }),
    ]);

    assert.strictEqual(authored.entries[0].icon, "$(git-pull-request)");
  });

  it("loads once more while GitHub works out whether a pull request merges cleanly", async () => {
    const approved: Partial<FakePullRequest> = {
      reviewDecision: "APPROVED",
      reviews: [review("alice", "APPROVED")],
    };
    const { authored } = await showInbox([
      mine(1, "Just pushed", { ...approved, mergeable: "UNKNOWN" }),
    ]);
    assert.strictEqual(authored.entries[0].icon, "$(git-pull-request)");

    await serveGitHub(
      { viewer, pullRequests: [mine(1, "Just pushed", approved)] },
      { settle: false }
    );
    await inboxSettled();

    assert.strictEqual(
      inboxEntry(await inbox(), "Just pushed").icon,
      "$(pass-filled)"
    );
  });

  it("loads once more only, while GitHub still doesn't know", async () => {
    await serveGitHub({
      viewer,
      pullRequests: [mine(1, "Stuck", { mergeable: "UNKNOWN" })],
    });
    await configure({ repositories: ["acme/api"] });
    await setToken(viewer.token);
    await refreshInbox();
    await serveGitHub(
      {
        viewer,
        pullRequests: [mine(1, "Stuck", { mergeable: "UNKNOWN" })],
      },
      { settle: false }
    );

    assert.strictEqual((await awaitingSearches()).length, 1);
    assert.strictEqual((await awaitingSearches()).length, 1);
  });

  it("keeps the author's avatar in the other groups", async () => {
    const { groups } = await showInbox([
      {
        repository: "acme/api",
        number: 9,
        title: "Theirs",
        author: "alice",
        reviewRequested: ["reviewer"],
        checks: "FAILURE",
        reviewDecision: "APPROVED",
      },
    ]);

    const entry = inboxEntry(groups, "Theirs");
    assert.ok(entry.icon && fs.existsSync(entry.icon), `icon: ${entry.icon}`);
    assert.strictEqual(entry.description, "acme/api #9 · checks failed");
  });
});
