import * as assert from "assert";
import {
  askAssistant,
  assistantRuns,
  flag,
  renderedPanel,
  replyTurn,
  scriptClaude,
  userMessages,
  showAssistant,
  summaryNote,
} from "../../assistant";
import { overviewTake } from "../../timeline";
import { closeChange, eventually, short } from "../../reviewer";
import { pickUpAfterReload } from "../handoff";

// A second launch of the workspace the first assistant launch left with a
// Change open and a conversation in its Assistant panel.
describe("The Assistant after a window reload", () => {
  const { change, title, sessionId } = pickUpAfterReload();
  scriptClaude(change, {
    turns: [replyTurn("You asked what new_helper returns.")],
  });

  after(() => closeChange(change));

  it("shows the summary in the overview again, without asking for a new one", async () => {
    await eventually(async () =>
      assert.deepStrictEqual(await overviewTake(title), {
        label: "Assistant",
        reading: false,
        text: "A summary.",
      })
    );
  });

  it("shows the earlier conversation again in its panel once asked", async () => {
    await showAssistant(change);
    await eventually(async () =>
      assert.deepStrictEqual(await renderedPanel(title), {
        name: title,
        range: `${short(change.base)}..${short(change.head)}`,
        login: "Claude subscription (Max)",
        busy: false,
        messages: [
          summaryNote,
          { from: "reviewer", text: "What does new_helper return?" },
          { from: "assistant", text: "It returns 2." },
        ],
      })
    );
    assert.deepStrictEqual(assistantRuns(change), [], "no new summary");
  });

  it("resumes the Claude session, so the Assistant remembers the earlier turns", async () => {
    await askAssistant(title, "What did I ask you before?");

    await eventually(async () =>
      assert.strictEqual(
        (await renderedPanel(title))?.messages.at(-1)?.text,
        "You asked what new_helper returns."
      )
    );
    const [run] = assistantRuns(change);
    assert.strictEqual(flag(run, "--resume"), sessionId);
    assert.strictEqual(run.sessionId, sessionId);
    assert.ok(
      run.resumed?.includes("What does new_helper return?"),
      `the resumed session has the earlier turns: ${run.resumed}`
    );
    assert.deepStrictEqual(userMessages(run), ["What did I ask you before?"]);
  });
});
