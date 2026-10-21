import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  assistantRuns,
  replyTurn,
  scriptClaude,
  summaryWritten,
  userMessages,
} from "../assistant";
import { codeColumnTab, shownDiff, shownText } from "../changeFiles";
import { findingsView, findIssues } from "../findings";
import { buildFixtureRepo } from "../fixtures";
import { closeChange, eventually, openChange, short } from "../reviewer";
import {
  clickRepeatedSite,
  renderedTimeline,
  sentTimeline,
  type ShownRepeatedEdits,
} from "../timeline";

/** A function whose lines differ in shape, so a copy of it is told from other code. */
const original = (name: string, items: string, item: string) =>
  [
    `def ${name}(${items}):`,
    "    seen = set()",
    "    out = []",
    `    for ${item} in ${items}:`,
    `        if ${item} in seen:`,
    "            continue",
    `        seen.add(${item})`,
    `        out.append(transform(${item}, 3))`,
    "    return out",
    "",
  ].join("\n");

/** A caller of `legacy_call`, `modern_call` or `other_call`, by its number. */
const caller = (call: string, n: number, extra = "") =>
  `import os\n\n\ndef run_${n}(x):\n    return ${call}(x, ${n}${extra})\n`;

/**
 * A Change of its own, in a repository of five callers of `legacy_call`, one
 * of `other_call`, which looks the same but isn't it, and an original block.
 * What the head does depends on the kind:
 * - `partial`: `a.py`, `b.py` and `c.py` call `modern_call` instead, `d.py`
 *   calls it with another argument, `e.py` is left alone, and `copy.py`
 *   copies the original block with other names.
 * - `uniform`: all five callers change alike, so nothing differs or is missed.
 * - `single`: one caller changes and nothing is repeated.
 */
function repeatChange(name: string, kind: "partial" | "uniform" | "single") {
  const repo = buildFixtureRepo(name);
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(repo.path, file)), { recursive: true });
    fs.writeFileSync(path.join(repo.path, file), text);
  };
  const commit = (message: string) => {
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", message);
    return repo.git("rev-parse", "HEAD");
  };
  const sites = [..."abcde"];
  sites.forEach((site, i) =>
    write(`src/${site}.py`, caller("legacy_call", i + 1))
  );
  write("src/other.py", caller("other_call", 9));
  write("lib/original.py", original("original", "items", "item"));
  const base = commit(`${name} base`);

  const swept = kind === "partial" ? "abc" : kind === "uniform" ? "abcde" : "a";
  sites.forEach((site, i) => {
    if (swept.includes(site))
      write(`src/${site}.py`, caller("modern_call", i + 1));
  });
  if (kind === "partial") {
    write("src/d.py", caller("modern_call", 4, ", strict=True"));
    write("src/copy.py", original("handle", "entries", "entry"));
  }
  const head = commit(`${name} head`);
  return {
    repo,
    request: { repository: repo.path, base, head },
    title: `${path.basename(repo.path)} ${short(base)}..${short(head)}`,
  };
}

/** The overview's Repeated edits once the repository's index is built, or what it holds without one. */
async function repeatedEditsOf(
  title: string,
  checked: ShownRepeatedEdits["checked"] = "complete"
): Promise<ShownRepeatedEdits | undefined> {
  let shown: ShownRepeatedEdits | undefined;
  await eventually(async () => {
    shown = (await sentTimeline(title)).repeatedEdits;
    assert.strictEqual(shown?.checked, checked);
  });
  return shown;
}

describe("Repeated edits in the overview", () => {
  const sweep = repeatChange("repeat-partial", "partial");

  before(async () => {
    await scriptClaude(sweep.request, {
      turns: [replyTurn("A summary.")],
    });
    await openChange(sweep.request);
  });

  after(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await closeChange(sweep.request);
  });

  it("lists a sweep with its differing site and the place that still holds the old code, and draws it", async () => {
    const shown = await repeatedEditsOf(sweep.title);

    assert.deepStrictEqual(shown, {
      checked: "complete",
      open: true,
      edits: [
        {
          summary: "This edit appears in 4 files",
          removed: ["    return legacy_call(x, 1)"],
          added: ["    return modern_call(x, 1)"],
          differing: [{ path: "src/d.py", side: "head", line: 5, endLine: 5 }],
          // Not other.py, which has the same shape but not the name legacy_call.
          missed: [{ path: "src/e.py", side: "head", line: 5, endLine: 5 }],
          moreMissed: 0,
        },
      ],
    });
    await eventually(async () =>
      assert.deepStrictEqual(
        (await renderedTimeline(sweep.title))?.repeatedEdits,
        shown,
        "the overview drew it"
      )
    );
  });

  it("opens a differing site as its file's diff at the hunk, and a missed site as the head file at its line", async () => {
    const shown = await repeatedEditsOf(sweep.title);
    const [edit] = shown!.edits;

    await clickRepeatedSite(sweep.title, edit.differing[0], false);

    await eventually(() => {
      const { original, modified } = shownDiff();
      assert.ok(original.fsPath.endsWith(path.join("src", "d.py")));
      assert.ok(modified.fsPath.endsWith(path.join("src", "d.py")));
      const editor = vscode.window.visibleTextEditors.find(
        (e) => e.document.uri.toString() === modified.toString()
      );
      assert.strictEqual(editor?.selection.start.line, 4, "at the hunk's line");
    });

    await clickRepeatedSite(sweep.title, edit.missed[0], true);

    await eventually(() => {
      const file = shownText();
      assert.ok(file.fsPath.endsWith(path.join("src", "e.py")));
      const editor = vscode.window.visibleTextEditors.find(
        (e) => e.document.uri.toString() === file.toString()
      );
      assert.strictEqual(editor?.selection.start.line, 4, "at the old code");
    });
    assert.ok(codeColumnTab(), "in the code column");
  });

  it("gives the Assistant the copied code and the differing and missed sites when the Reviewer asks for Findings", async () => {
    await summaryWritten(sweep.title);
    await scriptClaude(sweep.request, {
      turns: [replyTurn(JSON.stringify({ findings: [] }))],
    });

    await findIssues(sweep.request);

    const [run, ...others] = await assistantRuns(sweep.request);
    assert.deepStrictEqual(others, [], "one run of claude");
    const prompt = userMessages(run).find((m) => m.includes('"findings"'));
    assert.ok(prompt, "the Findings were asked for");
    for (const expected of [
      "Possible duplicate code (1), found by Dear Reviewer's rules",
      "src/copy.py:1-9 repeats lib/original.py:1-9",
      "Repeated edits that differ or were missed (1), found by Dear Reviewer's rules",
      "Edit 1, at 4 sites; most replaced:",
      "-     return legacy_call(x, 1)",
      "+     return modern_call(x, 1)",
      "differing site: src/d.py:5",
      "missed site: src/e.py:5",
      "name the original's `path:line`",
    ])
      assert.ok(prompt?.includes(expected), `${expected} in ${prompt}`);
    assert.ok(!prompt.includes("src/other.py:5"), "the look-alike is no site");
    assert.ok(
      !prompt.includes("ran out of time"),
      "the check covered the repository"
    );
    assert.deepStrictEqual(await findingsView(), [], "none raised");
  });
});

describe("Repeated edits that are all alike", () => {
  const alike = repeatChange("repeat-uniform", "uniform");

  before(async () => {
    await scriptClaude(alike.request, { turns: [replyTurn("A summary.")] });
    await openChange(alike.request);
  });

  after(() => closeChange(alike.request));

  it("show in a section that stays collapsed, with no differing or missed site", async () => {
    const shown = await repeatedEditsOf(alike.title);

    assert.deepStrictEqual(shown, {
      checked: "complete",
      open: false,
      edits: [
        {
          summary: "This edit appears in 5 files",
          removed: ["    return legacy_call(x, 1)"],
          added: ["    return modern_call(x, 1)"],
          differing: [],
          missed: [],
          moreMissed: 0,
        },
      ],
    });
  });

  it("put no candidate in the Findings prompt", async () => {
    await summaryWritten(alike.title);
    await scriptClaude(alike.request, {
      turns: [replyTurn(JSON.stringify({ findings: [] }))],
    });

    await findIssues(alike.request);

    const [run] = await assistantRuns(alike.request);
    const prompt = userMessages(run).find((m) => m.includes('"findings"'));
    assert.ok(prompt, "the Findings were asked for");
    assert.ok(!prompt.includes("Possible duplicate code"), prompt);
    assert.ok(!prompt.includes("Repeated edits that differ"), prompt);
  });
});

describe("A Change with no repetition", () => {
  const single = repeatChange("repeat-single", "single");

  before(async () => {
    await scriptClaude(single.request, { turns: [replyTurn("A summary.")] });
    await openChange(single.request);
  });

  after(() => closeChange(single.request));

  it("shows no Repeated edits section", async () => {
    // The overview has counted the Change's files, together with its Repeated edits.
    await eventually(async () =>
      assert.ok((await sentTimeline(single.title)).progress)
    );
    assert.strictEqual(
      (await sentTimeline(single.title)).repeatedEdits,
      undefined
    );
    assert.strictEqual(
      (await renderedTimeline(single.title))?.repeatedEdits,
      undefined
    );
  });
});
