import * as assert from "assert";
import { renderMarkdown } from "../../src/markdown";

describe("Markdown in a panel", () => {
  it("puts its headings two levels below the panel's own", () => {
    assert.strictEqual(
      renderMarkdown("# Title\n\n## Summary\n\n##### Deep").html,
      "<h3>Title</h3>\n<h4>Summary</h4>\n<h6>Deep</h6>\n"
    );
  });
});
