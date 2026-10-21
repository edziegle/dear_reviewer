import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { replyTurn, scriptClaude } from "../assistant";
import {
  changeFiles,
  codeColumnTab,
  entryAt,
  filesIn,
  markViewed,
  render,
  review,
} from "../changeFiles";
import { buildFixtureRepo } from "../fixtures";
import { closeChange, eventually, openChange, short } from "../reviewer";
import { renderedTimeline, sentTimeline } from "../timeline";

const imports = 'import a from "a";\nimport b from "b";\nimport c from "c";\n';

/**
 * A Change with files that were reformatted and files that look like it:
 * - `src/reformatted.ts` is wrapped and spaced out, with the same tokens.
 * - `src/reindented.py` is indented with 4 spaces instead of 2.
 * - `old/moved.ts` moves to `new/moved.ts` and is reformatted on the way.
 * - `old/moved-edited.ts` moves to `new/moved-edited.ts` with a real edit.
 * - `src/edited.ts`, `src/commented.ts` and `src/quoted.ts` change a value, a
 *   comment and a quote style.
 * - `src/template.ts` gains a blank line inside a template literal.
 * - `README.md` gains a blank line, and has no grammar.
 */
function formattingChange(name: string) {
  const repo = buildFixtureRepo(name);
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(repo.path, file)), { recursive: true });
    fs.writeFileSync(path.join(repo.path, file), text);
  };
  const remove = (file: string) => fs.rmSync(path.join(repo.path, file));
  const commit = (message: string) => {
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", message);
    return repo.git("rev-parse", "HEAD");
  };
  write(
    "src/reformatted.ts",
    "export function add(a:number,b:number){return a+b;}\n"
  );
  write("src/reindented.py", "def f(x):\n  if x:\n    return 1\n  return 2\n");
  write("old/moved.ts", `${imports}export const x={y:1};\nexport const z=2;\n`);
  write(
    "old/moved-edited.ts",
    `${imports}export const x={y:1};\nexport const z=2;\n`
  );
  write("src/edited.ts", "export const a = 1;\n");
  write("src/commented.ts", "// one\nexport const b = 1;\n");
  write("src/quoted.ts", 'export const c = "x";\n');
  write("src/template.ts", "export const t = `a\nb`;\n");
  write("README.md", "# Title\n\ntext\n");
  const base = commit("formatting base");

  write(
    "src/reformatted.ts",
    "export function add(\n  a: number,\n  b: number\n) {\n  return a + b;\n}\n"
  );
  write(
    "src/reindented.py",
    "def f(x):\n    if x:\n        return 1\n    return 2\n"
  );
  remove("old/moved.ts");
  write(
    "new/moved.ts",
    `${imports}export const x = {\n  y: 1\n};\nexport const z = 2;\n`
  );
  remove("old/moved-edited.ts");
  write(
    "new/moved-edited.ts",
    `${imports}export const x = {\n  y: 1\n};\nexport const z = 3;\n`
  );
  write("src/edited.ts", "export const a = 2;\n");
  write("src/commented.ts", "// two\nexport const b = 1;\n");
  write("src/quoted.ts", "export const c = 'x';\n");
  write("src/template.ts", "export const t = `a\n\nb`;\n");
  write("README.md", "# Title\n\n\ntext\n");
  const head = commit("formatting head");
  const request = { repository: repo.path, base, head };
  return {
    request,
    title: `${path.basename(repo.path)} ${short(base)}..${short(head)}`,
  };
}

describe("Formatting-only files", () => {
  const formattingOnly = [
    "new/moved.ts",
    "old/moved.ts",
    "src/reformatted.ts",
    "src/reindented.py",
  ];
  const notFormattingOnly = [
    "new/moved-edited.ts",
    "old/moved-edited.ts",
    "src/commented.ts",
    "src/edited.ts",
    "src/quoted.ts",
    "src/template.ts",
    "README.md",
  ];
  const reasons = {
    "new/moved.ts": "moved, formatting only",
    "old/moved.ts": "moved, formatting only",
    "src/reformatted.ts": "formatting only",
    "src/reindented.py": "formatting only",
  };

  const { request, title } = formattingChange("formatting-only");

  before(async () => {
    await scriptClaude(request, {
      turns: [replyTurn("Changes values. Start with src/edited.ts:1.")],
      readingOrder: replyTurn(
        JSON.stringify({
          steps: [
            {
              label: "The code",
              files: [
                { path: "src/edited.ts" },
                { path: "src/reformatted.ts" },
              ],
            },
          ],
        })
      ),
    });
    await openChange(request);
  });

  after(() => closeChange(request));

  it("shows them muted, with why, in the overview's Skim-only step, once the marks arrive, and leaves the other files alone", async () => {
    await eventually(async () => {
      const steps = (await sentTimeline(title)).readingOrder?.steps;
      const skim = steps?.find((step) => step.skimOnly);
      assert.deepStrictEqual(
        skim?.files.map((file) => [file.path, file.skim]),
        formattingOnly.map((file) => [
          file,
          reasons[file as keyof typeof reasons],
        ])
      );
      const others = steps
        ?.filter((step) => !step.skimOnly)
        .flatMap((step) => step.files.map((file) => file.path));
      assert.deepStrictEqual(
        [...(others ?? [])].sort(),
        [...notFormattingOnly].sort()
      );
    });

    await eventually(async () =>
      assert.deepStrictEqual(
        (await renderedTimeline(title))?.readingOrder,
        (await sentTimeline(title)).readingOrder,
        "the overview drew it"
      )
    );
  });

  it("shows them muted, with why, in Change Files in both modes", async () => {
    const tree = await changeFiles();
    const skimStep = entryAt(tree, title, "3. Skim-only");
    assert.strictEqual(skimStep.collapsed, true);
    assert.deepStrictEqual(
      skimStep.children.map((f) => [f.label, f.description, f.muted]),
      [
        ["moved.ts", "new · skim-only: moved, formatting only", true],
        ["moved.ts", "old · skim-only: moved, formatting only", true],
        ["reformatted.ts", "src · skim-only: formatting only", true],
        ["reindented.py", "src · skim-only: formatting only", true],
      ]
    );
    for (const entry of [
      entryAt(tree, title, "1. The code", "edited.ts"),
      entryAt(tree, title, "2. Other files", "commented.ts"),
      entryAt(tree, title, "2. Other files", "template.ts"),
    ])
      assert.strictEqual(entry.muted, undefined, entry.label);

    await vscode.commands.executeCommand("dearReviewer.sortByTree");
    try {
      const flat = render(await changeFiles());
      assert.ok(
        flat.includes("    reformatted.ts [M] — skim-only: formatting only"),
        flat.join("\n")
      );
      assert.ok(
        flat.some((line) => line.includes("skim-only: moved, formatting only")),
        flat.join("\n")
      );
      assert.ok(
        !flat.some(
          (line) => line.includes("edited.ts") && line.includes("skim-only")
        ),
        flat.join("\n")
      );
    } finally {
      await vscode.commands.executeCommand("dearReviewer.sortByReadingOrder");
    }
  });

  describe("when stepping through the files", () => {
    const stepping = formattingChange("formatting-stepping");
    const shown = () => {
      const files = filesIn(codeColumnTab());
      return (
        [...formattingOnly, ...notFormattingOnly].find((f) =>
          files.some((file) => file.endsWith(path.sep + path.normalize(f)))
        ) ?? files.join(" ↔ ")
      );
    };
    const goto = async (
      command: "nextUnviewedFile" | "previousUnviewedFile"
    ) => {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await review(command);
      let opened = "";
      await eventually(() => {
        opened = shown();
        assert.ok(
          [...formattingOnly, ...notFormattingOnly].includes(opened),
          `a file of the Change is shown, not ${opened}`
        );
      });
      return opened;
    };
    const visitSkimOnly = (on: boolean | undefined) =>
      vscode.workspace
        .getConfiguration("dearReviewer")
        .update("visitSkimOnlyFiles", on, vscode.ConfigurationTarget.Global);

    before(async () => {
      await scriptClaude(stepping.request, {
        turns: [replyTurn("Changes values. Start with src/edited.ts:1.")],
        readingOrder: replyTurn(
          JSON.stringify({
            steps: [{ label: "The code", files: [{ path: "src/edited.ts" }] }],
          })
        ),
      });
      await openChange(stepping.request);
      await eventually(async () => {
        const skim = (await sentTimeline(stepping.title)).readingOrder?.steps
          .filter((step) => step.skimOnly)
          .flatMap((step) => step.files);
        assert.strictEqual(skim?.length, formattingOnly.length);
      });
    });

    after(async () => {
      await visitSkimOnly(undefined);
      await closeChange(stepping.request);
    });

    it("passes over them, and visits them with the setting on", async () => {
      const last = await goto("previousUnviewedFile");
      assert.ok(
        notFormattingOnly.includes(last),
        `${last} is not formatting only`
      );

      await visitSkimOnly(true);

      assert.strictEqual(
        await goto("previousUnviewedFile"),
        "src/reindented.py"
      );
    });

    it("visits them once nothing else is left unviewed", async () => {
      await visitSkimOnly(false);
      const tree = await changeFiles();
      const row = entryAt(tree, stepping.title);
      await markViewed(
        ...row.children
          .filter((step) => step.label !== "3. Skim-only")
          .flatMap((step) => step.children)
      );
      await eventually(async () =>
        assert.strictEqual(
          render(await changeFiles()).filter((l) => l.includes("(viewed)"))
            .length,
          notFormattingOnly.length
        )
      );

      assert.strictEqual(await goto("nextUnviewedFile"), "new/moved.ts");
    });
  });
});
