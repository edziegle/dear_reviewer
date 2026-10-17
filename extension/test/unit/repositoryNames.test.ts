import * as assert from "assert";
import {
  gitHubHost,
  gitHubRepository,
  isRepositoryName,
  namesRepository,
} from "../../src/repositoryNames";

describe("A GitHub repository's name", () => {
  it("is owner/name, without search qualifiers or dot-only parts", () => {
    assert.strictEqual(isRepositoryName("acme/api"), true);
    assert.strictEqual(isRepositoryName("Acme-1/api_v2.x"), true);
    for (const name of [
      "acme/api is:closed",
      "acme/web+is:merged",
      "acme",
      "acme/api/extra",
      "../api",
      "acme/..",
      "",
    ])
      assert.strictEqual(isRepositoryName(name), false, name);
  });
});

describe("The host GitHub serves repositories from", () => {
  it("is github.com for the public API", () => {
    assert.strictEqual(gitHubHost("https://api.github.com"), "github.com");
  });

  it("is the server's own host for GitHub Enterprise Server, in lower case", () => {
    assert.strictEqual(
      gitHubHost("https://GHE.example.com/api/v3"),
      "ghe.example.com"
    );
  });

  it("is github.com when the URL can't be read", () => {
    assert.strictEqual(gitHubHost("not a url"), "github.com");
  });
});

describe("The repository a remote URL names", () => {
  const host = "github.com";

  it("is read from https, ssh and scp-style URLs, with or without .git", () => {
    for (const url of [
      "https://github.com/acme/api.git",
      "https://github.com/acme/api",
      "https://github.com/acme/api/",
      "ssh://git@github.com/acme/api.git",
      "git@github.com:acme/api.git",
      "git://github.com/acme/api",
    ])
      assert.strictEqual(gitHubRepository(url, host), "acme/api", url);
  });

  it("is none on another host", () => {
    assert.strictEqual(
      gitHubRepository("https://elsewhere.example/acme/web.git", host),
      undefined
    );
    assert.strictEqual(
      gitHubRepository("git@gitlab.com:acme/web.git", host),
      undefined
    );
  });

  it("is none for a name GitHub couldn't have, so it can't smuggle in a search qualifier", () => {
    assert.strictEqual(
      gitHubRepository("https://github.com/acme/web+is:merged.git", host),
      undefined
    );
  });

  it("is none for a URL that isn't one, or a local path", () => {
    assert.strictEqual(gitHubRepository("/srv/git/acme/api", host), undefined);
    assert.strictEqual(gitHubRepository("file:///acme/api", host), undefined);
  });

  it("matches the host without regard to case", () => {
    assert.strictEqual(
      gitHubRepository("https://GitHub.com/acme/api", host),
      "acme/api"
    );
  });
});

describe("Whether a remote URL names a repository", () => {
  it("is when it ends in owner/name on any host, whatever the case", () => {
    assert.strictEqual(
      namesRepository("https://example.com/Acme/Api.git", "acme/api"),
      true
    );
    assert.strictEqual(
      namesRepository("git@example.com:acme/api/", "acme/api"),
      true
    );
  });

  it("is not for another repository, or a longer name that merely ends the same", () => {
    assert.strictEqual(
      namesRepository("https://example.com/acme/other", "acme/api"),
      false
    );
    assert.strictEqual(
      namesRepository("https://example.com/xacme/api", "acme/api"),
      false
    );
  });
});
