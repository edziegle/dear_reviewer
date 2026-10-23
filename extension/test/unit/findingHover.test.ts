import * as assert from "assert";
import { marked } from "marked";
import { hoverHeading, plainText } from "../../src/findingHover";

/**
 * The text a hover shows for the Markdown, as VS Code renders it with marked:
 * its one paragraph's text with each line break as a newline and each
 * non-breaking space as U+00A0, a line of one alone showing as empty. It
 * fails if the Markdown made anything but a paragraph and line breaks.
 */
function shown(markdown: string): string {
  const html = (marked.parse(markdown, { gfm: true, async: false }) as string)
    .trim()
    .replace(/<br>\n?/g, "\n");
  const inner = /^<p>([^<]*)<\/p>$/.exec(html);
  assert.ok(inner, `renders as one paragraph of text: ${html}`);
  return inner[1]
    .replace(/^&nbsp;$/gm, "")
    .replace(/&nbsp;/g, "\u00a0")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

describe("A Finding's message in its hover", () => {
  const literal = (message: string) =>
    assert.strictEqual(
      shown(plainText(message)).replace(/\u00a0/g, " "),
      message
    );

  for (const [what, message] of [
    ["emphasis", "Use **bold** or _this_ or *that* or __those__ or ~~not~~."],
    ["a code span", "Call `free()` here."],
    ["a link", "See [the docs](https://example.com) first."],
    ["an image", "Look: ![cat](https://example.com/cat.png)"],
    ["a bare address", "Read https://example.com and www.example.com."],
    ["an email address", "Ask someone@example.com."],
    ["a command link", "[Run](command:workbench.action.reloadWindow)"],
    ["a leading #", "# Not a heading"],
    ["a leading >", "> not a quote"],
    ["a leading -", "- not a list"],
    ["a leading +", "+ not a list"],
    ["a leading 1.", "1. not a list"],
    ["a leading 1)", "1) not a list"],
    ["a thematic break", "***"],
    ["a table", "| a | b |\n| - | - |\n| 1 | 2 |"],
    ["a setext underline", "Not a heading\n==="],
    ["a fence", "```\ncode\n```"],
    ["an HTML tag", "Close the <b>tag</b> and <script>x()</script>."],
    ["an HTML entity", "Write &amp; or &lt; or &#65;."],
    ["a backslash", "A path like C:\\dir\\file and \\*."],
    ["a theme icon", "Not an icon: $(zap)."],
  ])
    it(`shows ${what} as the literal text`, () => literal(message));

  it("keeps its line breaks and blank lines", () =>
    literal("One line.\nAnother.\n\nA new paragraph.\n\n\nAfter two."));

  it("keeps a line's leading spaces, which would make code", () =>
    literal("Before:\n    indented code\n  two spaces"));

  it("keeps a run of spaces", () => literal("one   three  two"));

  it("reads a Windows line break as one", () =>
    assert.strictEqual(
      shown(plainText("One.\r\nTwo.")).replace(/\u00a0/g, " "),
      "One.\nTwo."
    ));

  it("breaks only between words, at ordinary spaces", () => {
    const text = shown(
      plainText("Every word here can wrap, so a long-message breaks   cleanly.")
    );
    assert.ok(!/\S\u00a0\S/.test(text), `no word glued to the next: ${text}`);
    for (const gap of text.match(/[ \u00a0]+/g) ?? [])
      assert.ok(
        gap.includes(" "),
        `each gap can break: ${JSON.stringify(text)}`
      );
  });
});

describe("The heading of a Finding's hover", () => {
  const cat = "file:///ext/media/finding-cat.svg";

  it("leads with the cat and the Assistant's name, then the count", () =>
    assert.strictEqual(
      hoverHeading(cat, { position: 2, total: 3 }),
      `![](${cat}|width=13,height=13) **Assistant** · Finding 2 of 3`
    ));

  it("has no count for a Finding with no place among the Change's", () =>
    assert.strictEqual(
      hoverHeading(cat, undefined),
      `![](${cat}|width=13,height=13) **Assistant** · Finding`
    ));

  it("gives the cat empty alt text, so the name is read once", () => {
    const html = marked.parse(hoverHeading(cat, undefined), {
      gfm: true,
      async: false,
    }) as string;
    assert.match(html, /<img src="[^"]*" alt="">/);
    assert.strictEqual(html.match(/Assistant/g)?.length, 1);
  });
});
