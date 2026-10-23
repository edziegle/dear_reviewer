import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  allowedWithoutAsking,
  ClaudeCli,
  claudeEnvironment,
  ClaudeProblem,
  describeLogin,
  gitServerConnected,
  readOnlyTools,
  resolveClaude,
} from "../../src/assistant/claude";

describe("The environment claude runs in", () => {
  it("leaves out credential variables, which could bill an API key or a cloud provider", () => {
    const environment = claudeEnvironment({
      PATH: "/usr/bin",
      ANTHROPIC_API_KEY: "sk-ant-test",
      ANTHROPIC_AUTH_TOKEN: "bearer-test",
      ANTHROPIC_BASE_URL: "https://elsewhere.example",
      CLAUDE_CODE_OAUTH_TOKEN: "oauth-test",
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDE_CODE_USE_VERTEX: "1",
      CLAUDE_CODE_USE_FOUNDRY: "1",
    });

    assert.deepStrictEqual(environment, { PATH: "/usr/bin" });
  });

  it("keeps only what claude needs to find itself, its login and the network", () => {
    const environment = claudeEnvironment({
      HOME: "/home/reviewer",
      CLAUDE_CONFIG_DIR: "/home/reviewer/.claude-work",
      HTTPS_PROXY: "http://proxy.example:3128",
      no_proxy: "localhost",
      NODE_EXTRA_CA_CERTS: "/etc/ca.pem",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      DEAR_REVIEWER_UNRELATED: "dropped",
      GITHUB_TOKEN: "dropped",
    });

    assert.deepStrictEqual(environment, {
      HOME: "/home/reviewer",
      CLAUDE_CONFIG_DIR: "/home/reviewer/.claude-work",
      HTTPS_PROXY: "http://proxy.example:3128",
      no_proxy: "localhost",
      NODE_EXTRA_CA_CERTS: "/etc/ca.pem",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
    });
  });
});

describe("The login claude auth status reports", () => {
  it("is a subscription, with its plan, that isn't billed per token", () => {
    assert.deepStrictEqual(
      describeLogin({
        loggedIn: true,
        authMethod: "claude.ai",
        subscriptionType: "max",
      }),
      {
        signedIn: true,
        method: "claude.ai",
        label: "Claude subscription (Max)",
        billedPerToken: false,
      }
    );
  });

  it("is billed per token for an API key, and by the provider for a cloud provider", () => {
    assert.strictEqual(
      describeLogin({ loggedIn: true, authMethod: "api_key" }).billedPerToken,
      true
    );
    const cloud = describeLogin({
      loggedIn: true,
      authMethod: "third_party",
      apiProvider: "bedrock",
    });
    assert.strictEqual(cloud.billedPerToken, true);
    assert.strictEqual(
      cloud.label,
      "Cloud provider (bedrock), billed by the provider"
    );
  });

  it("is not signed in without a method or when claude says so", () => {
    assert.strictEqual(describeLogin({}).signedIn, false);
    const out = describeLogin({ loggedIn: false, authMethod: "claude.ai" });
    assert.strictEqual(out.signedIn, false);
    assert.strictEqual(out.label, "not signed in");
  });
});

describe("What the Assistant may do without asking", () => {
  it("is its git tools, and no file tool, which would allow reads anywhere", () => {
    assert.deepStrictEqual(allowedWithoutAsking, [
      "mcp__git__log",
      "mcp__git__show",
      "mcp__git__blame",
      "mcp__git__diff",
    ]);
    for (const tool of readOnlyTools)
      assert.ok(
        !allowedWithoutAsking.some((allowed) => allowed.startsWith(tool)),
        tool
      );
  });
});

describe("The command that starts claude", () => {
  let dir: string;
  let program: string;
  const originalPath = process.env.PATH;
  const executable = (file: string) =>
    fs.writeFileSync(file, "#!/bin/sh\n", { mode: 0o755 });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-command-"));
    program = path.join(dir, "sandbox-claude");
    executable(program);
  });
  afterEach(() => {
    process.env.PATH = originalPath;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("finds claude on the PATH when neither setting is given", () => {
    executable(path.join(dir, "claude"));
    process.env.PATH = dir;

    assert.deepStrictEqual(resolveClaude([], ""), {
      program: path.join(dir, "claude"),
      args: [],
    });
  });

  it("takes a one-item command as a path, with ~ expanded", () => {
    assert.deepStrictEqual(resolveClaude([program], ""), {
      program,
      args: [],
    });
    assert.deepStrictEqual(resolveClaude(["~/sandbox-claude"], "", dir), {
      program,
      args: [],
    });
  });

  it("looks a bare first item up on the PATH", () => {
    process.env.PATH = dir;

    assert.deepStrictEqual(resolveClaude(["sandbox-claude"], ""), {
      program,
      args: [],
    });
  });

  it("makes the later items arguments, which go before Dear Reviewer's own", () => {
    assert.deepStrictEqual(
      resolveClaude([program, "exec", "-i", "box", "claude"], ""),
      { program, args: ["exec", "-i", "box", "claude"] }
    );
  });

  it("uses Claude Path as a one-item command only when Claude Command is empty", () => {
    assert.deepStrictEqual(resolveClaude([], program), { program, args: [] });
    const other = path.join(dir, "other");
    executable(other);
    assert.deepStrictEqual(resolveClaude([other], program), {
      program: other,
      args: [],
    });
  });

  it("says the program isn't found when it is missing or can't be run", () => {
    const plain = path.join(dir, "plain");
    fs.writeFileSync(plain, "text", { mode: 0o644 });
    process.env.PATH = dir;
    for (const command of [
      [path.join(dir, "nowhere"), "exec"],
      [plain],
      ["no-such-program"],
    ])
      assert.throws(
        () => resolveClaude(command, ""),
        (err: unknown) =>
          err instanceof ClaudeProblem &&
          err.kind === "notFound" &&
          err.message.includes(`\`${JSON.stringify(command)}\``)
      );
  });

  it("names the command as JSON when it isn't found, so quotes and spaces in an item show", () => {
    for (const command of [
      ['"~/.foo/my-command"'],
      [path.join(dir, "my claude"), "--flag"],
    ])
      assert.throws(
        () => resolveClaude(command, "", dir),
        (err: unknown) =>
          err instanceof ClaudeProblem &&
          err.kind === "notFound" &&
          err.message.startsWith(
            `Claude Code isn't at ${JSON.stringify(command[0])}, so \`${JSON.stringify(command)}\` can't run.`
          )
      );
  });

  it("names the command as JSON when it can't be run", async () => {
    const spaced = path.join(dir, "my claude");
    fs.writeFileSync(spaced, "#!/no/such/interpreter\n", { mode: 0o755 });
    const command = resolveClaude([spaced, '"--flag"'], "");

    await assert.rejects(
      new ClaudeCli(command).login(),
      (err: unknown) =>
        err instanceof ClaudeProblem &&
        err.kind === "notFound" &&
        err.message.startsWith(
          `Couldn't run Claude Code with \`${JSON.stringify([spaced, '"--flag"'])}\`.`
        )
    );
  });
});

describe("The Claude Command setting", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../../../package.json"), "utf8")
  ) as {
    contributes: {
      configuration: {
        properties: Record<
          string,
          { items: { pattern: string; patternErrorMessage: string } }
        >;
      };
    };
  };
  const items =
    manifest.contributes.configuration.properties["dearReviewer.claudeCommand"]
      .items;
  // VSCodium compiles an item's pattern with the u flag.
  const pattern = new RegExp(items.pattern, "u");

  it("rejects an item wrapped in quotes, which would be part of the path", () => {
    for (const item of ['"~/bin/claude"', "'claude'", ' "x" ', '""'])
      assert.strictEqual(pattern.test(item), false, item);
  });

  it("accepts an item without wrapping quotes", () => {
    for (const item of ["~/bin/claude", '--flag="x"', "docker"])
      assert.strictEqual(pattern.test(item), true, item);
  });

  it("says to leave the quotes out, ending so that several messages read apart", () => {
    assert.match(items.patternErrorMessage, /quotes/);
    assert.match(items.patternErrorMessage, /\. $/);
  });
});

describe("Whether claude started the git server", () => {
  const init = (mcp_servers?: { name: string; status: string }[]) => ({
    type: "system",
    subtype: "init",
    mcp_servers,
  });

  it("is yes for a connected git server", () => {
    assert.strictEqual(
      gitServerConnected(init([{ name: "git", status: "connected" }])),
      true
    );
  });

  it("is no for a failed or otherwise unconnected server, a missing entry or a missing list", () => {
    for (const event of [
      init([{ name: "git", status: "failed" }]),
      init([{ name: "git", status: "pending" }]),
      init([{ name: "other", status: "connected" }]),
      init([]),
      init(undefined),
    ])
      assert.strictEqual(gitServerConnected(event), false);
  });
});
