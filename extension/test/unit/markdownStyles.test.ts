import * as assert from "assert";
import { reviewStyles, sharedStyles } from "../../src/markdownStyles";

/** The declarations of the first rule whose selector list holds exactly this selector. */
function declarationsOf(selector: string): Record<string, string> | undefined {
  for (const [, selectors, body] of sharedStyles.matchAll(
    /^\s*([^{}\n]+)\{([^}]*)\}/gm
  )) {
    if (!selectors.split(",").some((s) => s.trim() === selector)) continue;
    return Object.fromEntries(
      body
        .split(";")
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => {
          const colon = d.indexOf(":");
          return [d.slice(0, colon).trim(), d.slice(colon + 1).trim()];
        })
    );
  }
}

// VS Code's own stylesheet colors every `code` with the theme's
// preformatted-text color, which goes with the theme's preformatted-text
// ground. Dear Reviewer draws code on its code-block ground, so it names the
// text color too: in High Contrast Light the default is white on a near-white
// ground.
describe("Code in rendered Markdown", () => {
  it("takes the theme's foreground, not the preformatted-text color VS Code's stylesheet gives it", () => {
    const code = declarationsOf(".markdown code");
    assert.strictEqual(code?.color, "var(--vscode-foreground)");
  });

  it("is drawn on the code-block ground, which the text color goes with", () => {
    const code = declarationsOf(".markdown code");
    assert.strictEqual(
      code?.background,
      "var(--vscode-textCodeBlock-background)"
    );
  });

  it("keeps a fenced block's text color too, by leaving it to the inline rule", () => {
    const fenced = declarationsOf(".markdown pre code");
    assert.ok(fenced, "a rule for fenced code");
    assert.strictEqual(
      fenced.color,
      undefined,
      "no color of its own: it takes the one above, rather than the webview default"
    );
  });

  it("takes a link's color when it is in a link", () => {
    assert.strictEqual(declarationsOf(".markdown a code")?.color, "inherit");
  });
});

describe("Review verdict colors", () => {
  const approvedGreen =
    "color-mix(in srgb, var(--vscode-testing-iconPassed) 70%, var(--vscode-foreground))";

  function markColor(verdict: string): string | undefined {
    const rule = new RegExp(
      `\\.review\\.${verdict} \\.mark \\{ color: (.+); \\}`
    );
    return reviewStyles.match(rule)?.[1];
  }

  it("colors an approved mark with the softened green", () => {
    assert.strictEqual(markColor("approved"), approvedGreen);
  });

  it("colors a briefed mark the same green as an approved one", () => {
    assert.strictEqual(markColor("briefed"), approvedGreen);
  });

  it("colors a changes-requested mark with the failed icon color", () => {
    assert.strictEqual(
      markColor("changesRequested"),
      "var(--vscode-testing-iconFailed)"
    );
  });

  it("mutes a commented mark", () => {
    assert.strictEqual(
      markColor("commented"),
      "var(--vscode-descriptionForeground)"
    );
  });
});
