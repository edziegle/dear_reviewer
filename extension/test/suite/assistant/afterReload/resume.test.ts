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

/** The review chord, as the Reviewer's platform writes it. */
const chord = process.platform === "darwin" ? "⌃⌥R" : "Ctrl+Alt+R";

// A second launch of the workspace the first assistant launch left with a
// Change open and a conversation in its Assistant panel.
describe("The Assistant after a window reload", () => {
  const { change, title, sessionId } = pickUpAfterReload();
  before(() =>
    scriptClaude(change, {
      turns: [replyTurn("You asked what new_helper returns.")],
    })
  );

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
          {
            from: "note",
            text: `Raised 1 Finding, marked in the gutter of the diff and listed in the Findings view. ${chord} F steps through them, and ${chord} Shift+F back.`,
          },
          {
            from: "reviewer",
            text: "What does new_helper return?",
            // Still a Finding's chip, without its message or code.
            context: [
              {
                path: "util.py",
                side: "head",
                startLine: 1,
                endLine: 1,
                finding: {},
              },
            ],
          },
          { from: "assistant", text: "It returns 2." },
        ],
      })
    );
    assert.deepStrictEqual(await assistantRuns(change), [], "no new summary");
  });

  it("resumes the Claude session, so the Assistant remembers the earlier turns", async () => {
    await askAssistant(title, "What did I ask you before?");

    await eventually(async () =>
      assert.strictEqual(
        (await renderedPanel(title))?.messages.at(-1)?.text,
        "You asked what new_helper returns."
      )
    );
    const [run] = await assistantRuns(change);
    assert.strictEqual(flag(run, "--resume"), sessionId);
    assert.strictEqual(run.sessionId, sessionId);
    assert.ok(
      // After the Finding's lines it was asked with.
      run.resumed?.some((m) => m.endsWith("\nWhat does new_helper return?")),
      `the resumed session has the earlier turns: ${run.resumed}`
    );
    assert.deepStrictEqual(userMessages(run), ["What did I ask you before?"]);
  });
});
