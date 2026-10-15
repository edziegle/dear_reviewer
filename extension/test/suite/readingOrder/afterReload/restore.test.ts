import * as assert from "assert";
import { assistantRuns, replyTurn, scriptClaude } from "../../assistant";
import { changeFiles, render } from "../../changeFiles";
import { eventually } from "../../reviewer";
import { sentTimeline, showTimeline } from "../../timeline";
import { pickUpAfterReload } from "../handoff";

// The second launch of the readingOrder suite, as after a window reload.
describe("The Reading Order after a reload", () => {
  const handoff = pickUpAfterReload();

  before(() =>
    scriptClaude(handoff.branch, {
      turns: [replyTurn("Shouldn't be asked.")],
      readingOrder: replyTurn('{"steps": []}'),
    })
  );

  it("comes back in Change Files and the overview without another Claude turn", async () => {
    await eventually(async () =>
      assert.deepStrictEqual(render(await changeFiles()), handoff.changeFiles)
    );
    await showTimeline(handoff.branch);
    await eventually(async () =>
      assert.deepStrictEqual(
        (await sentTimeline(handoff.overview)).readingOrder,
        handoff.readingOrder
      )
    );
    assert.deepStrictEqual(await assistantRuns(handoff.branch), []);
  });
});
