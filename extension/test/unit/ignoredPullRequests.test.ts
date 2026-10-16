import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { IgnoredPullRequests } from "../../src/dashboard/ignored";

describe("IgnoredPullRequests", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ignored-"));
    // The folder of a window's storage may not exist yet.
    file = path.join(dir, "storage", "ignored-pull-requests.json");
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("ignores none until the Reviewer ignores one", () => {
    assert.deepStrictEqual([...new IgnoredPullRequests(file).ids()], []);
  });

  it("keeps what the Reviewer ignored for a window that starts later", () => {
    new IgnoredPullRequests(file).ignore("pull request acme/api#7");
    new IgnoredPullRequests(file).ignore("pull request acme/api#9");

    assert.deepStrictEqual([...new IgnoredPullRequests(file).ids()].sort(), [
      "pull request acme/api#7",
      "pull request acme/api#9",
    ]);
  });

  it("restores one without touching the others", () => {
    const ignored = new IgnoredPullRequests(file);
    ignored.ignore("pull request acme/api#7");
    ignored.ignore("pull request acme/api#9");

    ignored.restore("pull request acme/api#7");

    assert.deepStrictEqual(
      [...new IgnoredPullRequests(file).ids()],
      ["pull request acme/api#9"]
    );
  });

  it("ignores the same pull request twice as once, and restores one it doesn't hold without error", () => {
    const ignored = new IgnoredPullRequests(file);
    ignored.ignore("pull request acme/api#7");
    ignored.ignore("pull request acme/api#7");
    ignored.restore("pull request acme/api#8");

    assert.deepStrictEqual([...ignored.ids()], ["pull request acme/api#7"]);
  });

  it("forgets the ones that left the Inbox, and keeps the ones still in it", () => {
    const ignored = new IgnoredPullRequests(file);
    ignored.ignore("pull request acme/api#7");
    ignored.ignore("pull request acme/api#9");

    ignored.keepOnly(["pull request acme/api#9", "pull request acme/api#11"]);

    assert.deepStrictEqual(
      [...new IgnoredPullRequests(file).ids()],
      ["pull request acme/api#9"]
    );
  });

  it("reads a file it can't make sense of as none ignored, and writes over it", () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{");
    const ignored = new IgnoredPullRequests(file);
    assert.deepStrictEqual([...ignored.ids()], []);

    ignored.ignore("pull request acme/api#7");

    assert.deepStrictEqual(
      [...new IgnoredPullRequests(file).ids()],
      ["pull request acme/api#7"]
    );
  });
});
