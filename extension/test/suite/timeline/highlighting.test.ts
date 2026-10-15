import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { buildFixtureRepo } from "../fixtures";
import { closeChange, eventually, openChange, short } from "../reviewer";
import {
  clickDontAskAgain,
  clickFindExtension,
  renderedTimeline,
  sentTimeline,
} from "../timeline";

interface LanguagesApi {
  searchWith(search?: (query: string) => void): void;
}

async function languagesApi(): Promise<LanguagesApi> {
  const extension = vscode.extensions.getExtension<{
    languages: LanguagesApi;
  }>("edziegle.dear-reviewer");
  if (!extension) throw new Error("Dear Reviewer is not installed");
  return (await extension.activate()).languages;
}

// The test VSCodium has no OpenTofu extension, and no language covers
// `.tofu` or `.zzz`.
describe("The overview's offer to find a language extension", () => {
  const repo = buildFixtureRepo("highlighting");
  const write = (file: string, text: string | Buffer) => {
    fs.mkdirSync(path.dirname(path.join(repo.path, file)), {
      recursive: true,
    });
    fs.writeFileSync(path.join(repo.path, file), text);
  };
  const commit = (message: string) => {
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", message);
    return repo.git("rev-parse", "HEAD");
  };
  const base = repo.commits.restructured;
  write("infra/main.tofu", 'resource "null_resource" "x" {}\n');
  write("infra/notes.txt", "Plain on purpose.\n");
  write("infra/blob.dat", Buffer.from([0, 1, 2, 0, 255, 0]));
  write("infra/Makefile", "all:\n\ttrue\n");
  write("infra/helper.py", "HELPER = 1\n");
  const tofu = commit("add infrastructure");
  write("infra/other.TOFU", "locals {}\n");
  write("infra/odd.zzz", "odd\n");
  const more = commit("add more infrastructure");
  const first = { repository: repo.path, base, head: tofu };
  const second = { repository: repo.path, base: tofu, head: more };
  const titleOf = (change: { base: string; head: string }) =>
    `${path.basename(repo.path)} ${short(change.base)}..${short(change.head)}`;
  const searches: string[] = [];
  let associations: unknown;

  before(async () => {
    associations = vscode.workspace
      .getConfiguration("files")
      .inspect("associations")?.globalValue;
    (await languagesApi()).searchWith((query) => searches.push(query));
  });

  after(async () => {
    (await languagesApi()).searchWith(undefined);
    await vscode.workspace
      .getConfiguration("files")
      .update("associations", associations, vscode.ConfigurationTarget.Global);
    await closeChange(first);
    await closeChange(second);
  });

  it("names the file extension no installed language highlights", async () => {
    await openChange(first);

    await eventually(async () => {
      const timeline = await renderedTimeline(titleOf(first));
      assert.strictEqual(timeline?.loading, false);
      assert.deepStrictEqual(timeline?.unhighlighted, [".tofu"]);
    });
  });

  it("searches the Extensions view for the bare file extension", async () => {
    assert.ok(
      (await vscode.commands.getCommands()).includes(
        "workbench.extensions.search"
      ),
      "the Extensions view takes a search"
    );

    await clickFindExtension(titleOf(first), ".tofu");
    // Only a file extension the overview offered.
    await clickFindExtension(titleOf(first), ".exe");

    assert.deepStrictEqual(searches, ["tofu"]);
  });

  it("drops a file extension the Reviewer's settings come to cover", async () => {
    const files = vscode.workspace.getConfiguration("files");
    await files.update(
      "associations",
      { "*.tofu": "plaintext" },
      vscode.ConfigurationTarget.Global
    );
    await eventually(async () => {
      const timeline = await sentTimeline(titleOf(first));
      assert.strictEqual(timeline.unhighlighted, undefined);
    });

    await files.update(
      "associations",
      associations,
      vscode.ConfigurationTarget.Global
    );
    await eventually(async () => {
      const timeline = await sentTimeline(titleOf(first));
      assert.deepStrictEqual(timeline.unhighlighted, [".tofu"]);
    });
  });

  it("doesn't ask again, in this Change or another", async () => {
    await clickDontAskAgain(titleOf(first));

    await eventually(async () => {
      const timeline = await renderedTimeline(titleOf(first));
      assert.ok(timeline, "the overview rendered");
      assert.strictEqual(timeline.unhighlighted, undefined);
    });

    await openChange(second);
    await eventually(async () => {
      const timeline = await renderedTimeline(titleOf(second));
      assert.strictEqual(timeline?.loading, false);
      assert.deepStrictEqual(timeline?.unhighlighted, [".zzz"]);
    });
  });
});
