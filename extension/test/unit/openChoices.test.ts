import * as assert from "assert";
import { Listed, openChoices } from "../../src/openChoices";

const pr = (repository: string, number: number, title: string): Listed => ({
  kind: "pullRequest",
  pullRequest: { repository, number, title, author: { login: "casey" } },
});

describe("Open Pull Request or Branch…'s choices", () => {
  const groups: Listed[] = [
    { kind: "group", label: "Awaiting my review", children: [pr("acme/api", 482, "Retry webhooks")] },
    {
      kind: "group",
      label: "Authored by me",
      children: [pr("acme/api", 482, "Retry webhooks"), pr("acme/web", 7, "Fix login")],
    },
    {
      kind: "group",
      label: "Local branches",
      children: [
        { kind: "localBranch", branch: { name: "agent/docs", repository: "acme/api", commitsAhead: 1 } },
        { kind: "localBranch", branch: { name: "agent/fix", repository: "acme/api", commitsAhead: 3 } },
      ],
    },
  ];

  it("lists each pull request and branch once, in the Inbox's order, under its group", () => {
    assert.deepStrictEqual(
      openChoices(groups).map((c) => [c.group, c.label]),
      [
        ["Awaiting my review", "acme/api #482"],
        ["Authored by me", "acme/web #7"],
        ["Local branches", "agent/docs"],
        ["Local branches", "agent/fix"],
      ]
    );
  });

  it("names the title and the author of a pull request", () => {
    const [first] = openChoices(groups);
    assert.strictEqual(first.detail, "Retry webhooks");
    assert.strictEqual(first.description, "casey");
  });

  it("says how far ahead a branch is, and in which repository", () => {
    const [, , one, three] = openChoices(groups);
    assert.deepStrictEqual([one.description, one.detail], ["1 commit ahead", "acme/api"]);
    assert.strictEqual(three.description, "3 commits ahead");
  });

  it("offers nothing for a problem or an empty Inbox", () => {
    assert.deepStrictEqual(openChoices([{ kind: "problem" }]), []);
    assert.deepStrictEqual(openChoices([]), []);
  });
});
