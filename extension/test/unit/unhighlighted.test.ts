import * as assert from "assert";
import { unhighlighted } from "../../src/unhighlighted";

describe("Which file extensions go unhighlighted", () => {
  const python = { extensions: [".py"] };

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
