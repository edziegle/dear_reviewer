import * as assert from "assert";
import { changeFiles, render, showViewedFiles } from "../../changeFiles";
import { closeChange, openChange } from "../../reviewer";
import { pickUpAfterReload } from "../handoff";

// A second launch of the workspace the first changeFiles launch left with a
// Active Change, two of its files viewed and viewed files hidden.
describe("The Change files view after a reload", () => {
  const { title, ...request } = pickUpAfterReload();

  it("still lists only the Active Change", async () => {
    assert.deepStrictEqual(
      (await changeFiles()).map((entry) => entry.label),
      [title]
    );
  });

  it("still hides viewed files", async () => {
    assert.deepStrictEqual(render(await changeFiles()), [
      `${title} — ■■□□□□□ 2/7`,
      "  pkg",
      "    legacy.py [D]",
      "  added.py [A]",
      "  main.py [M]",
      "  obsolete.py [D]",
      "  util.py [M]",
    ]);
  });

  it("still knows which files were viewed", async () => {
    await showViewedFiles();

    assert.deepStrictEqual(render(await changeFiles()), [
      `${title} — ■■□□□□□ 2/7`,
      "  pkg",
      "    sub",
      "      new.py [A] (viewed)",
      "    core.py [M] (viewed)",
      "    legacy.py [D]",
      "  added.py [A]",
      "  main.py [M]",
      "  obsolete.py [D]",
      "  util.py [M]",
    ]);
  });

  it("keeps viewed files when the Change is closed, for when it opens again", async () => {
    await closeChange(request);
    assert.deepStrictEqual(render(await changeFiles()), []);

    await openChange(request);
    const reopened = render(await changeFiles());
    await closeChange(request);

    assert.strictEqual(reopened[0], `${title} — ■■□□□□□ 2/7`);
  });
});
