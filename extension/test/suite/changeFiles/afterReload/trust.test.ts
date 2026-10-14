import * as assert from "assert";
import { buildFixtureRepo } from "../../fixtures";
import { closeChange, openChange } from "../../reviewer";
import { answering, standInForTrust } from "../../trust";

// The second launch, after the first dismissed the question.
describe("The question whether to trust the review window's folder after a restart", () => {
  it("isn't asked again", async () => {
    const repo = buildFixtureRepo("trust-again");
    const request = {
      repository: repo.path,
      base: repo.commits.initial,
      head: repo.commits.renamed,
    };
    const { asked, ask } = answering("Trust…");
    await standInForTrust({ isTrusted: false, ask });

    await openChange(request);
    await closeChange(request);

    assert.deepStrictEqual(asked, []);
    await standInForTrust({ isTrusted: true });
  });
});
