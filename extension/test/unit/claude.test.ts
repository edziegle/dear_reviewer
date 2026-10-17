import * as assert from "assert";
import { claudeEnvironment, describeLogin } from "../../src/assistant/claude";

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
