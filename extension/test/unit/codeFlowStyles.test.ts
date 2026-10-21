import * as assert from "assert";
import { codeFlowStyles } from "../../src/codeFlowStyles";

/** Every rule of the Code Flow's stylesheet, as its selectors and declarations. */
function rules(): {
  selectors: string[];
  declarations: Record<string, string>;
}[] {
  return [...codeFlowStyles.matchAll(/^\s*([^{}\n]+)\{([^}]*)\}/gm)].map(
    ([, selectors, body]) => ({
      selectors: selectors.split(",").map((s) => s.trim()),
      declarations: Object.fromEntries(
        body
          .split(";")
          .map((d) => d.trim())
          .filter(Boolean)
          .map((d) => {
            const colon = d.indexOf(":");
            return [d.slice(0, colon).trim(), d.slice(colon + 1).trim()];
          })
      ),
    })
  );
}

const selectedRules = () =>
  rules().filter((rule) =>
    rule.selectors.some((s) => s.includes("[aria-selected=true]"))
  );

// High Contrast Dark leaves `list.activeSelectionBackground` and
// `list.activeSelectionForeground` unset, and High Contrast Light the
// foreground: a selected symbol drawn in them alone had black text on a black
// ground.
describe("A selected symbol or call in the Code Flow", () => {
  it("falls back wherever it takes the list's selection colors, which high-contrast themes leave unset", () => {
    const bare = selectedRules().flatMap((rule) =>
      Object.entries(rule.declarations)
        .filter(([, value]) =>
          /var\(--vscode-list-activeSelection\w+\)/.test(value)
        )
        .map(([property]) => `${rule.selectors.join(", ")} { ${property} }`)
    );
    assert.deepStrictEqual(bare, []);
  });

  it("draws its text in the editor's foreground where the theme has no selection foreground", () => {
    const text = selectedRules().find((rule) =>
      rule.selectors.includes(".node[aria-selected=true] text")
    );
    assert.strictEqual(
      text?.declarations.fill,
      "var(--vscode-list-activeSelectionForeground, var(--vscode-editor-foreground))"
    );
  });

  it("is outlined in the theme's high-contrast outline, which only high-contrast themes set", () => {
    const ring = selectedRules().find((rule) =>
      rule.selectors.includes(".node[aria-selected=true] .ring")
    );
    assert.strictEqual(
      ring?.declarations.stroke,
      "var(--vscode-contrastActiveBorder, transparent)"
    );
    const row = selectedRules().find(
      (rule) =>
        rule.selectors.includes(".call[aria-selected=true] .hit") &&
        "stroke" in rule.declarations
    );
    assert.match(
      row?.declarations.stroke ?? "",
      /^var\(--vscode-contrastActiveBorder, /
    );
  });
});

describe("The Code Flow's toggles", () => {
  it("show they are on with the editor's own toggle colors, not a filled button", () => {
    const pressed = rules().find((rule) =>
      rule.selectors.includes(".seg button[aria-pressed=true]")
    );
    assert.strictEqual(
      pressed?.declarations.background,
      "var(--vscode-inputOption-activeBackground)"
    );
  });
});

describe("The selected symbol's calls in the call map", () => {
  it("are drawn in the focus color, arrowheads too, apart from the others", () => {
    const find = (selector: string) =>
      rules().find((rule) => rule.selectors.includes(selector))?.declarations;
    assert.strictEqual(
      find(".selected-call .edge")?.stroke,
      "var(--vscode-focusBorder)"
    );
    assert.strictEqual(
      find(".arrow.selected")?.fill,
      "var(--vscode-focusBorder)"
    );
  });

  it("are labelled in the foreground, knocked out of the calls that cross the label", () => {
    const label = rules().find((rule) =>
      rule.selectors.includes(".edge-label")
    )?.declarations;
    assert.strictEqual(label?.fill, "var(--vscode-editor-foreground)");
    assert.strictEqual(label?.["paint-order"], "stroke");
    assert.strictEqual(label?.stroke, "var(--vscode-editor-background)");
  });
});
