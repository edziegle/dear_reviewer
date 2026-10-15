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

interface LanguageContribution {
  extensions?: string[];
  filenames?: string[];
  filenamePatterns?: string[];
}

interface LanguagesApi {
  searchWith(search?: (query: string) => void): void;
  unhighlighted(
    files: { path: string; binary?: boolean }[],
    languages: LanguageContribution[],
    associations: Record<string, string>,
    dismissed: Set<string>
  ): string[];
}

async function languagesApi(): Promise<LanguagesApi> {
  const extension = vscode.extensions.getExtension<{
    languages: LanguagesApi;
  }>("edziegle.dear-reviewer");
  if (!extension) throw new Error("Dear Reviewer is not installed");
  return (await extension.activate()).languages;
}

describe("Which file extensions go unhighlighted", () => {
  const python = { extensions: [".py"] };
  let unhighlighted: LanguagesApi["unhighlighted"];

  before(async () => {
    unhighlighted = (await languagesApi()).unhighlighted;
  });

  it("finds a file extension no language covers", () => {
    assert.deepStrictEqual(
      unhighlighted(
        [{ path: "app.py" }, { path: "infra/main.tofu" }],
        [python],
        {},
        new Set()
      ),
      [".tofu"]
    );
  });

  it("leaves out one a language contributes", () => {
    assert.deepStrictEqual(
      unhighlighted(
        [{ path: "infra/main.tofu" }],
        [python, { extensions: [".tf", ".tofu"] }],
        {},
        new Set()
      ),
      []
    );
  });

  it("leaves out a file a language names", () => {
    assert.deepStrictEqual(
      unhighlighted(
        [
          { path: "deploy/build.gradle.kts" },
          { path: "ci/Jenkinsfile.groovy" },
        ],
        [{ filenames: ["build.gradle.kts", "Jenkinsfile.groovy"] }],
        {},
        new Set()
      ),
      []
    );
  });

  it("leaves out a file a language's pattern matches", () => {
    assert.deepStrictEqual(
      unhighlighted(
        [{ path: "infra/main.tofu" }, { path: "conf/app.ini.tmpl" }],
        [{ filenamePatterns: ["**/infra/*.tofu", "*.ini.{tmpl,j2}"] }],
        {},
        new Set()
      ),
      []
    );
  });

  it("leaves out one the Reviewer's files.associations covers", () => {
    assert.deepStrictEqual(
      unhighlighted(
        [{ path: "infra/main.tofu" }, { path: "infra/vars.tfvars" }],
        [],
        { "*.tofu": "terraform", "**/infra/*.tfvars": "terraform" },
        new Set()
      ),
      []
    );
  });

  it("leaves out extensions that are plain on purpose", () => {
    assert.deepStrictEqual(
      unhighlighted(
        [
          { path: "notes.txt" },
          { path: "Cargo.lock" },
          { path: "data.csv" },
          { path: "logo.svg" },
        ],
        [],
        {},
        new Set()
      ),
      []
    );
  });

  it("leaves out files without an extension", () => {
    assert.deepStrictEqual(
      unhighlighted(
        [{ path: "LICENSE" }, { path: ".gitignore" }, { path: "bin/tool" }],
        [],
        {},
        new Set()
      ),
      []
    );
  });

  it("leaves out binary files", () => {
    assert.deepStrictEqual(
      unhighlighted([{ path: "model.onnx", binary: true }], [], {}, new Set()),
      []
    );
  });

  it("leaves out dismissed extensions", () => {
    assert.deepStrictEqual(
      unhighlighted(
        [{ path: "main.tofu" }, { path: "main.tf" }],
        [],
        {},
        new Set([".tofu"])
      ),
      [".tf"]
    );
  });

  it("ignores case, and names each file extension once", () => {
    assert.deepStrictEqual(
      unhighlighted(
        [{ path: "A.TOFU" }, { path: "b.tofu" }, { path: "c.Hcl" }],
        [{ extensions: [".HCL"] }],
        {},
        new Set()
      ),
      [".tofu"]
    );
  });
});

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
