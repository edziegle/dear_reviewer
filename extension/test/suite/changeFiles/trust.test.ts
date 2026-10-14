import * as assert from "assert";
import { buildFixtureRepo } from "../fixtures";
import { closeChange, openChange } from "../reviewer";
import { answering, standInForTrust } from "../trust";

// Runs in the first launch; ./afterReload checks the answer outlasts it.
describe("The question whether to trust the review window's folder", () => {
  it("is answered Not now by being dismissed", async () => {
    const repo = buildFixtureRepo("trust-first");
    const request = {
      repository: repo.path,
      base: repo.commits.initial,
      head: repo.commits.renamed,
    };
    const { asked, ask } = answering(undefined);
    await standInForTrust({ isTrusted: false, fresh: true, ask });

    await openChange(request);
    await closeChange(request);

    assert.strictEqual(asked.length, 1);
  });
});
