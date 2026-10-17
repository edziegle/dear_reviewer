import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

interface Property {
  default?: unknown;
}

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../../../package.json"), "utf8")
) as {
  contributes: { configuration: { properties: Record<string, Property> } };
};
const settings = manifest.contributes.configuration.properties;

describe("Dear Reviewer's settings", () => {
  it("talk to github.com unless the Reviewer sets another GitHub API base URL", () => {
    assert.strictEqual(
      settings["dearReviewer.githubApiUrl"].default,
      "https://api.github.com"
    );
  });

  it("list no more repositories by default", () => {
    assert.deepStrictEqual(settings["dearReviewer.repositories"].default, []);
  });
});
