# Running Claude on the user's own subscription from a macOS app

Research date: 2026-10-12. Versions inspected: `@anthropic-ai/claude-code` 2.1.296 (npm, published 2026-10-09), `@anthropic-ai/claude-agent-sdk` 0.3.296 (npm), `claude-agent-sdk` 0.2.165 (PyPI), and a locally installed `claude` 2.1.289 (Homebrew). The Claude Code docs at code.claude.com change often and are versioned by Claude Code release, so recheck any quote here before relying on it.

Context: `dear_reviewer` has no README or source yet (the repo has no commits). This note assumes the planned app is a macOS code-review tool that wants Claude to review diffs or pull requests, billed to the reviewer's own Claude plan instead of an API key.

Labels used below:

- **Documented**: stated by an Anthropic or Apple primary source, cited inline.
- **Source code**: read from Anthropic's published package or repo, cited by file and version.
- **Inferred**: my reasoning from documented facts. It is not an Anthropic statement.
- **Secondary**: press or third-party reporting, labeled where cited.
- **Unverified**: I could not confirm it from a primary source.

---

## Summary

1. **Only one route is clearly allowed: the user's own, unmodified Claude Code.** That means the user installs `claude`, signs in through Anthropic's own flow, and Claude Code makes the model calls. Your app can drive it with `claude -p` or plug into it as an MCP server or plugin. Anthropic's Legal and compliance page forbids third-party developers from offering Claude.ai login, routing requests through Free/Pro/Max credentials "on behalf of their users", and collecting, storing, or intermediating Claude.ai credentials or tokens. The same page explicitly does not prevent "an end user from signing in to the unmodified Claude Code binary with their own Claude subscription" ([Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)).
2. **The Agent SDK docs say third-party products may not use subscription login unless Anthropic approves it.** The quote: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK" ([Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)). A support article updated 2026-10-07 says "Claude Agent SDK, `claude -p`, and third-party apps" still draw from subscription limits ([support 15036540](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)). The two sources don't line up, and nobody from Anthropic has answered a public question about it ([claude-agent-sdk-typescript#382](https://github.com/anthropics/claude-agent-sdk-typescript/issues/382), 0 replies).
3. **Calling the API directly with a subscription OAuth token, or spoofing Claude Code, is prohibited and blocked.** Anthropic "tightened our safeguards against spoofing the Claude Code harness" in January 2026 ([@trq212, 2026-01-09](https://x.com/trq212/status/2009689809875591565)).
4. **Billing depends on which credential the `claude` process finds, and an API key wins quietly.** In `-p` mode a present `ANTHROPIC_API_KEY` "is always used", ahead of the subscription login ([Authentication precedence](https://code.claude.com/docs/en/authentication#authentication-precedence)). `--bare` never reads the subscription login at all ([headless: bare mode](https://code.claude.com/docs/en/headless#start-faster-with-bare-mode)).
5. **The Mac App Store is effectively ruled out for this design.** MAS apps must be sandboxed ([App Review 2.4.5(i)](https://developer.apple.com/app-store/review/guidelines/)), and an embedded helper runs with the app's inherited sandbox ([Apple: embedding a helper tool](https://developer.apple.com/documentation/xcode/embedding-a-helper-tool-in-a-sandboxed-app)). A sandboxed child could not use the user's existing Claude Code install and login (inferred). Ship outside the MAS with Developer ID signing and the hardened runtime.

## Recommendation

For `dear_reviewer`:

1. **Default to "Use my installed Claude Code" mode.** Spawn the user's own `claude` binary with `claude -p --output-format stream-json`, using a tight `--tools`/`--allowedTools` list (read-only tools for review) and `--permission-mode dontAsk`. Never read, copy, or prompt for Claude credentials. If the user isn't logged in, tell them to run `claude` in Terminal and sign in. Don't run `/login` yourself and don't offer a "Sign in with Claude" button.
2. **Control the child environment.** Build the child env explicitly. Remove `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`, and `CLAUDE_CODE_OAUTH_TOKEN` unless the user picked that billing mode. Before each run, call `claude auth status` and show its `authMethod` (`claude.ai`, `api_key`, `api_key_helper`, `oauth_token`, `third_party`, or `none`) in the UI, so the user can see which account pays.
3. **Offer a second mode: "Use an Anthropic API key".** The user's key goes into your app's own Keychain item and is passed as `ANTHROPIC_API_KEY`. This is the mode Anthropic documents for third-party products ([Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)). Max and Team subscribers can fund it with their plan's monthly API credit ([support 17154008](https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans)).
4. **Add an MCP server or Claude Code plugin as a complement.** It exposes the app's review context (diff, PR threads, the comments the reviewer writes) to the user's interactive Claude Code session. That usage is plainly on the subscription and plainly allowed, because the user is the one running Claude Code.
5. **Before shipping subscription mode to the public, ask Anthropic for written confirmation.** The Agent SDK note says "Unless previously approved", and [contact sales](https://www.anthropic.com/contact-sales) is the documented channel ([Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)). Treat subscription mode as at risk until Anthropic confirms it. Don't use the Agent SDK's bundled binary for subscription mode (see section 2).

---

## 1. Shelling out to the `claude` CLI

### What headless mode gives you (documented)

- `-p`/`--print` runs non-interactively. Exit code is 0 on success, and a failure inside the run, "such as missing authentication", is printed as the result on stdout ([headless: Basic usage](https://code.claude.com/docs/en/headless#basic-usage)).
- `--output-format text|json|stream-json`. `json` returns "structured JSON with result, session ID, and metadata". `stream-json` returns "newline-delimited JSON for real-time streaming". Add `--verbose --include-partial-messages` for token deltas. The last stream line is a `result` message ([headless: Get structured output](https://code.claude.com/docs/en/headless#get-structured-output), [Stream responses](https://code.claude.com/docs/en/headless#stream-responses)).
- `--json-schema` returns schema-validated output in `structured_output` ([headless](https://code.claude.com/docs/en/headless#get-structured-output)). This suits machine-readable review findings.
- `--input-format text|stream-json` sets the print-mode input format. `--replay-user-messages` requires stream-json on both sides ([CLI reference: flags](https://code.claude.com/docs/en/cli-reference#cli-flags)). Combined, they give a long-lived bidirectional process. This is the transport the Agent SDK uses (inferred from the SDK spawning the same binary; see section 2).
- Sessions: `--continue`, `--resume <id|name|path-to-.jsonl>`, `--session-id <uuid>`, `--fork-session`, `--no-session-persistence` ([CLI reference](https://code.claude.com/docs/en/cli-reference#cli-flags); [headless: Continue conversations](https://code.claude.com/docs/en/headless#continue-conversations)). Get `session_id` from the JSON output and pass it to `--resume`.
- Tool control:
  - `--tools` restricts the built-in tool set.
  - `--allowedTools` auto-approves tools, using rule syntax such as `Bash(git diff *)`.
  - `--disallowedTools` denies tools.
  - `--permission-mode` takes `default|acceptEdits|plan|auto|dontAsk|bypassPermissions`.
  - `--permission-prompt-tool` routes prompts to an MCP tool.
  - `--permission-prompts none` (v2.1.259+) denies anything that would otherwise prompt.

  Sources: [CLI reference](https://code.claude.com/docs/en/cli-reference#cli-flags); [headless: Auto-approve tools](https://code.claude.com/docs/en/headless#auto-approve-tools). The docs warn that a run with no explicit mode "takes the built-in starting permission mode ..., which can be `auto`, so pass the one you want" ([headless](https://code.claude.com/docs/en/headless#auto-approve-tools)).
- Security note: "Without `--bare`, a `-p` session runs the hooks in a project's `.claude/settings.json` and connects the servers in its `.mcp.json`, even in a folder you've never trusted" ([headless: bare mode](https://code.claude.com/docs/en/headless#start-faster-with-bare-mode)). This matters for a reviewer app that opens untrusted PR checkouts. You can't fix it with `--bare` in subscription mode (see below). Mitigations:
  - `--setting-sources user` so project settings don't load.
  - `--strict-mcp-config` with an explicit `--mcp-config`.
  - `--restricted` (v2.1.248+), which "loads only managed settings and `--settings`" and removes command-running tools ([CLI reference](https://code.claude.com/docs/en/cli-reference#cli-flags)).

  Whether `--setting-sources user` also blocks project `.mcp.json` servers is unverified, so test it.
- `--max-budget-usd` and the `total_cost_usd` in JSON output are "client-side estimates" ([headless](https://code.claude.com/docs/en/headless#pipe-data-through-claude)). On a subscription they don't correspond to a charge (inferred).

### How it finds the login, and which billing applies (documented)

Precedence, quoted from [Authentication precedence](https://code.claude.com/docs/en/authentication#authentication-precedence):

1. Cloud provider credentials, when `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, or `CLAUDE_CODE_USE_FOUNDRY` is set.
2. `ANTHROPIC_AUTH_TOKEN` (bearer, for gateways).
3. `ANTHROPIC_API_KEY`: "In non-interactive mode (`-p`), the key is always used when present."
4. `apiKeyHelper` script output (a settings key, so it can come from `~/.claude/settings.json` with nothing in the environment).
5. `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`).
6. Anthropic profile or federation credentials.
7. "Subscription OAuth credentials from `/login`. This is the default for Claude Pro, Max, Team, and Enterprise users."

A signed-in Claude apps gateway session outranks all of these (same section).

Billing for `claude -p`:

- Signed in with a Claude plan: "claude -p and Agent SDK usage still draw from your plan's usage limits and don't use your API credits" ([support 17154008, FAQ "Does this cover claude -p?"](https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans)).
- As of the 2026-06-15 and 2026-10-07 updates: "Claude Agent SDK, claude -p, and third-party app usage still draw from your subscription limits" ([support 15036540](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)).
- The "Agent SDK credit" announced 2026-05-13 ([@ClaudeDevs](https://x.com/ClaudeDevs/status/2054610152817619388)) would have moved this usage to a separate credit. It was paused on 2026-06-15 and is "not available" ([support 17154008 FAQ](https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans)).
- Pro/Max limits (a five-hour session limit plus weekly limits) are "shared across Claude and Claude Code" ([support 11145838](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan)). Your app's runs eat into the same budget as the user's chat and coding.

### The API-key pitfall (documented)

- "If you have an `ANTHROPIC_API_KEY` environment variable set on your system, Claude Code will use this API key for authentication instead of your Claude subscription ..., resulting in API usage charges" ([support 11145838](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan)).
- The env-var reference says the key "is used instead of your Claude Pro, Max, Team, or Enterprise subscription even if you are logged in. In non-interactive mode (`-p`), the key is always used when present" ([env vars: ANTHROPIC_API_KEY](https://code.claude.com/docs/en/env-vars)).
- In interactive mode the user gets a one-time approval prompt. In `-p` there is none.

How this hits a macOS app (inferred):

- An app launched from Finder or the Dock usually does not inherit variables exported in `~/.zshrc`.
- But the common fix for the PATH problem, running `claude` through a login or interactive shell (`zsh -lic`), does pick up an `ANTHROPIC_API_KEY` the user exported for other tools. Billing then silently switches to the API.
- `apiKeyHelper` in `~/.claude/settings.json` has the same effect with nothing in the environment.
- Detection: `claude auth status` "Show[s] authentication status as JSON ... The JSON's `authMethod` field is one of `none`, `claude.ai`, `oauth_token`, `api_key`, `api_key_helper`, or `third_party`" ([CLI reference: commands](https://code.claude.com/docs/en/cli-reference#cli-commands)). On this machine the output also included `apiProvider`, `subscriptionType`, `orgName`, and `configDirectory` keys (observed with 2.1.289; values not recorded).

### `--bare` disables subscription auth (documented)

"In bare mode, Claude Code never reads OAuth credentials or the system keychain" ([headless: bare mode](https://code.claude.com/docs/en/headless#start-faster-with-bare-mode)). It also doesn't read `CLAUDE_CODE_OAUTH_TOKEN` ([Authentication: Generate a long-lived token](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token)). The docs say `--bare` "will become the default for `-p` in a future release" (same section). If that ships, a subscription-mode integration will have to opt out explicitly. Watch the changelog for an opt-out flag (inferred).

---

## 2. Claude Agent SDK (TypeScript and Python)

### What it is (documented and source code)

- The SDK is "A library that runs the Claude Code binary" ([Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)).
- "Both the TypeScript and Python SDKs bundle a native Claude Code binary, so most installs need no separate Claude Code install" ([Quickstart, Install the SDK note](https://code.claude.com/docs/en/agent-sdk/quickstart)).
- TS 0.3.296 pulls the binary from per-platform optional dependencies (`@anthropic-ai/claude-agent-sdk-darwin-arm64`, and others). It errors with "Native CLI binary for ... not found ... or set options.pathToClaudeCodeExecutable" when they're missing (source: `sdk.mjs` in `@anthropic-ai/claude-agent-sdk@0.3.296`).
- Python: `_find_cli()` checks the bundled `_bundled/claude` first, then `shutil.which("claude")`, then a fixed list: `~/.npm-global/bin`, `/usr/local/bin`, `~/.local/bin`, `~/node_modules/.bin`, `~/.yarn/bin`, `~/.claude/local/claude`. Source: [`src/claude_agent_sdk/_internal/transport/subprocess_cli.py`](https://github.com/anthropics/claude-agent-sdk-python/blob/dbc975eb2771acac751258a8c3b08100cdc54a50/src/claude_agent_sdk/_internal/transport/subprocess_cli.py#L255-L339) at `dbc975e` (2026-09-25). Homebrew's `/opt/homebrew/bin` is not in that list.
- The SDK tags its traffic:
  - TS sets `CLAUDE_CODE_ENTRYPOINT="sdk-ts"` (source: `sdk.mjs` 0.3.296).
  - Python sets `"CLAUDE_CODE_ENTRYPOINT": "sdk-py"` and `CLAUDE_AGENT_SDK_VERSION` (source: `subprocess_cli.py` lines ~814-825 at `dbc975e`).
  - The TS types document `CLAUDE_AGENT_SDK_CLIENT_APP` ("Your app/library identifier ... to include in the User-Agent header") (source: `sdk.d.ts` 0.3.296, `env` option).
  - Inferred: Anthropic can tell SDK-driven and app-identified traffic apart from interactive Claude Code.
- TS `env` option: "When set, this value REPLACES the subprocess environment entirely — it is not merged with `process.env`" (source: `sdk.d.ts` 0.3.296). This is the hook for scrubbing `ANTHROPIC_API_KEY`.

### Does it use the subscription login? (documented and source code)

**Technically, yes, if one exists.** The SDK spawns the same binary, which applies the same precedence and reads the macOS Keychain login.

- The authentication page says `apiKeyHelper`, `ANTHROPIC_API_KEY`, and `ANTHROPIC_AUTH_TOKEN` "apply to the CLI and the surfaces that wrap it, including ... the Agent SDK" ([Authentication: Credential management](https://code.claude.com/docs/en/authentication#credential-management)).
- `CLAUDE_CODE_OAUTH_TOKEN` is described as an "Alternative to `/login` for SDK and automated environments" ([env vars](https://code.claude.com/docs/en/env-vars)).
- The TS SDK's session-store resume path reads the Keychain item itself with `security find-generic-password -a <user> -w -s "Claude Code-credentials"` when no API key or OAuth token env var is set. It copies the result, minus `refreshToken`, into a temp config dir (source: `sdk.mjs` 0.3.296, functions around `rWe`/`nWe`).

**Documented position for third-party products: API key, unless approved.**

- Quickstart: "Get an API key from the Claude Console ... then set it as an environment variable" ([Quickstart: Set your API key](https://code.claude.com/docs/en/agent-sdk/quickstart)).
- Exact wording, in both the overview and the quickstart:

  > "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described in the Quickstart instead."
  > — [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview), [Quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart)

- "Use of the Claude Agent SDK is governed by Anthropic's Commercial Terms of Service, including when you use it to power products and services that you make available to your own customers and end users" ([Agent SDK overview: License and terms](https://code.claude.com/docs/en/agent-sdk/overview)).
- Branding: you may say "{YourAgentName} Powered by Claude", but not "Claude Code" or "Claude Code Agent" ([overview: Branding guidelines](https://code.claude.com/docs/en/agent-sdk/overview)).

**The tension.** The help-center article says "You can still use the Claude Agent SDK, claude -p, and third-party apps with your subscription limits" ([support 15036540](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan), 2026-10-07 update). The May 2026 announcement listed "Third-party apps built on the Agent SDK" among the usages the planned credit would cover ([@ClaudeDevs, 2026-05-13](https://x.com/ClaudeDevs/status/2054610152817619388)). So Anthropic acknowledges that third-party SDK apps run on subscriptions, while its developer docs say not to offer that without approval.

Inferred reading: a user running an SDK-based app on their own login is metered against their plan. Whether a developer may build and distribute an app that relies on it is governed by the "unless previously approved" rule. I found no Anthropic answer to this exact question ([claude-agent-sdk-typescript#382](https://github.com/anthropics/claude-agent-sdk-typescript/issues/382), open, 0 comments). Related feature requests to open subscription auth to third-party apps are open or were closed as not planned ([claude-code#82266](https://github.com/anthropics/claude-code/issues/82266), which cites #1454 "closed as Not Planned").

**SDK vs. CLI for this app (inferred).** The SDK's bundled binary is a copy of Claude Code that your app ships. The Legal page's carve-out covers "the unmodified Claude Code binary". Shipping it as part of your product falls under "preinstalling or running Claude Code in your products", which requires the Commercial Terms and that each end user authenticate with their own credentials. Spawning the user's own installed `claude` is the closer fit to "an end user signing in to the unmodified Claude Code binary". For a Swift macOS app, the SDK also adds a Node or Python runtime for little gain over driving `claude -p --input-format stream-json --output-format stream-json` directly.

---

## 3. `claude setup-token` and `CLAUDE_CODE_OAUTH_TOKEN`

Documented ([Authentication: Generate a long-lived token](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token); [CLI reference](https://code.claude.com/docs/en/cli-reference#cli-commands); [env vars](https://code.claude.com/docs/en/env-vars)):

- Purpose: "For CI pipelines, scripts, or other environments where interactive browser login isn't available, generate a one-year OAuth token."
- It "opens the same browser authorization flow as `/login`". The token prints to the terminal. "It does not save the token anywhere."
- "This token authenticates with your Claude subscription and requires a Pro, Max, Team, or Enterprise plan. It can only make model requests, so it can't establish Remote Control sessions or fetch claude.ai connectors. MCP servers you configure locally still work."
- It is not read in `--bare` mode.
- It ranks 5th in precedence, above the `/login` Keychain credential and below `ANTHROPIC_API_KEY`.
- "To replace an expired token, generate a new one and restart."
- `claude setup-token` enforces only `forceLoginMethod`, not `forceLoginOrgUUID`, "so they can mint a token in a different organization" ([Authentication: Restrict login to your organization](https://code.claude.com/docs/en/authentication#restrict-login-to-your-organization)).

For a distributed app (inferred from the Legal page): asking users to paste a `setup-token` value into your app, or storing it, is collecting and storing a Claude.ai credential. The Legal page forbids that: "developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow" ([Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)). The token is meant for the user's own CI and scripts. If a user exports `CLAUDE_CODE_OAUTH_TOKEN` in their own shell, `claude` will use it, but your app shouldn't ask for it.

---

## 4. Where Claude Code keeps the login on macOS

I didn't read any secrets. I only listed file names.

- Documented: "On macOS, credentials are stored in the encrypted macOS Keychain. When the Keychain rejects the write, such as when it's locked in an SSH session, Claude Code stores your login in `~/.claude/.credentials.json` with file mode `0600` instead" ([Authentication: Credential management](https://code.claude.com/docs/en/authentication#credential-management)). The troubleshooting page says it uses the login Keychain (`~/Library/Keychains/login.keychain-db`) and calls the fallback file "plaintext" ([Troubleshoot install: Not logged in or token expired](https://code.claude.com/docs/en/troubleshoot-install)).
- Documented: with `CLAUDE_CONFIG_DIR` set, `.credentials.json` lives under that directory, and Claude Code "keys the macOS Keychain entry to that directory too, so a session with a different `CLAUDE_CONFIG_DIR` reads a different entry" ([Authentication](https://code.claude.com/docs/en/authentication#credential-management)).
- Source code (`@anthropic-ai/claude-agent-sdk@0.3.296`, `sdk.mjs`):
  - The Keychain item is a generic password with service name `` `Claude Code${OAUTH_FILE_SUFFIX}-credentials${suffix}` ``. `OAUTH_FILE_SUFFIX` is `""` in the production config, so the service is **`Claude Code-credentials`**.
  - When `CLAUDE_CONFIG_DIR` (or `CLAUDE_SECURESTORAGE_CONFIG_DIR`) is set, the suffix is `-<first 8 hex of sha256(config dir)>`.
  - The account is `$USER`, falling back to `claude-code-user`.
  - The stored JSON has a `claudeAiOauth` object with a `refreshToken` field.
- Files: `~/.claude/` holds settings (`settings.json`), sessions/transcripts (`projects/`), and `ide/` lock files. `~/.claude.json` holds global config and local- and user-scope MCP servers ([MCP: scopes](https://code.claude.com/docs/en/mcp); [Setup: Remove configuration files](https://code.claude.com/docs/en/setup#remove-configuration-files)). On this machine, `~/.claude/` has no `.credentials.json`, which is consistent with Keychain storage.
- Console sign-in without an API key stores an "Anthropic profile" under `~/.config/anthropic` instead ([Authentication: Anthropic profiles](https://code.claude.com/docs/en/authentication#anthropic-profiles-and-federation-credentials)).

For the app (inferred): don't read this Keychain item. The Legal page bars intermediating credentials, macOS would show a Keychain access prompt naming your app, and the format is internal and changes.

---

## 5. Auth precedence and the billing pitfalls

The full order is in section 1. The cases that matter for an app:

| What's present in the child process | What `claude -p` uses | Who pays |
| --- | --- | --- |
| Nothing but `/login` (Pro/Max/Team/Enterprise) | Keychain OAuth | Subscription limits; extra usage only if the user has enabled it ([support 11145838](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan)) |
| `ANTHROPIC_API_KEY` set (for example inherited through `zsh -lic`) | API key, always, no prompt in `-p` | Console org, pay per token |
| `apiKeyHelper` in user settings | Helper's key | Console org |
| `CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY=1` | Cloud credentials | AWS / GCP / Azure |
| `CLAUDE_CODE_OAUTH_TOKEN` | setup-token | Subscription |
| `--bare` | Never OAuth or Keychain | API key / helper / cloud only |

Cloud sessions ignore `ANTHROPIC_API_KEY` ("always use your subscription credentials"), but that applies to claude.ai/code cloud sessions, not local `-p` ([Authentication precedence](https://code.claude.com/docs/en/authentication#authentication-precedence)). Managed settings (`forceLoginMethod`, `forceLoginOrgUUID`, `allowedProviders`) can block environment credentials at startup on company machines (same page, "Restrict login to your organization"). An app should show the resulting startup error rather than retry.

---

## 6. IDE integration, MCP, and Desktop routes

### 6a. The app as an MCP server or plugin that Claude Code calls (documented; keeps usage on the subscription)

- The user registers your server with `claude mcp add [--scope user|project|local] <name> -- <command> [args...]`, or with a project `.mcp.json` ([MCP: installation scopes](https://code.claude.com/docs/en/mcp)). The app could ship a small stdio MCP server, or a Claude Code plugin that bundles one plus review skills, exposing tools such as `get_pr_diff`, `list_review_threads`, and `post_review_comment` (the plugin is inferred design; the plugin mechanism is documented under [plugins](https://code.claude.com/docs/en/agent-sdk/plugins)).
- Billing: model calls are made by the user's own Claude Code session under their own login. This is the "end user signing in to the unmodified Claude Code binary" case that the Legal page leaves alone. Your server never sees credentials (inferred from [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)).
- Trade-off: the user drives from Claude Code (terminal, IDE, or the Desktop Code tab), not from your UI.
- Channels (research preview): an MCP server that declares `claude/channel` can "push messages directly into your session" ([MCP](https://code.claude.com/docs/en/mcp)). Limits: channels need claude.ai or Console auth, must be plugins "on the approved allowlist" unless the user runs `--dangerously-load-development-channels`, and are blocked on Team/Enterprise until an Owner enables them ([Channels](https://code.claude.com/docs/en/channels)). That's too fragile for a product dependency today (inferred).
- `claude mcp serve` is the opposite direction. It "only exposes Claude Code's tools to your MCP client" ([MCP: Use Claude Code as an MCP server](https://code.claude.com/docs/en/mcp)). It provides no model access, so it doesn't help an app get completions. Unverified whether any model calls happen under it.

### 6b. The Claude Code IDE-integration protocol (documented for VS Code; not a public third-party API)

- Documented: "When the extension is active, it runs a local MCP server that the CLI connects to automatically." It "binds to `127.0.0.1` on a random port in the range 10000–65535", uses unencrypted `ws://`, and writes a fresh auth token "to a lock file at `~/.claude/ide/<port>.lock`". The CLI must present that token as the `X-Claude-Code-Ide-Authorization` header. The lock file is `0600` in a `0700` directory. Tools visible to the model are `mcp__ide__getDiagnostics` and `mcp__ide__executeCode`; the rest are internal RPC ([VS Code: The built-in IDE MCP server](https://code.claude.com/docs/en/vs-code)). `/ide` and `--ide` connect the CLI to it ([CLI reference](https://code.claude.com/docs/en/cli-reference#cli-flags)).
- Billing: the user's Claude Code session, so the subscription. "Your Pro or Max plan also covers Claude Code in supported IDEs" ([support 11145838](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan)).
- Inferred: a macOS app could pose as an "IDE" by writing a lock file and serving that WebSocket MCP endpoint, so a terminal `claude` session opens diffs in your UI. Anthropic documents this for its own extensions, not as a stable contract, and the lock-file schema isn't documented on that page (unverified). It is also the kind of client imitation that the 2026 enforcement targeted, although here the model calls still come from genuine Claude Code. Avoid it. A normal MCP server (6a) gets the same benefits through a supported interface.

### 6c. Claude Desktop extensions (MCPB) (documented; keeps usage on the subscription)

- "An MCP Bundle (`.mcpb`) is a zip archive containing a local MCP server and a `manifest.json`, which Claude Desktop installs in a single click." It runs locally over stdio, and Node.js ships with Claude Desktop ([Build a desktop extension with MCPB](https://claude.com/docs/connectors/building/mcpb)). Directory listings for MCPB are deprecated. Users install the file themselves, or you ship the server inside a plugin (same page).
- Billing: model use happens in Claude Desktop under the user's plan. "Claude Desktop and cloud sessions do not call `apiKeyHelper` or read these environment variables: they use OAuth" ([Authentication](https://code.claude.com/docs/en/authentication#credential-management)).
- Trade-off: the conversation lives in Claude Desktop, not in your app.

---

## 7. Policy and Terms of Service

### Governing text (documented)

**Claude Code Legal and compliance**, [Authentication and credential use](https://code.claude.com/docs/en/legal-and-compliance):

> "**OAuth authentication** is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications."
>
> "**Developers** building products or services that interact with Claude's capabilities, including those using the Agent SDK, should use API key authentication through Claude Console or a supported cloud provider. Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow."
>
> "... Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code as described under *Can customers offer Claude Code in their products?* above."
>
> "Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice."

Same page, [Can customers offer Claude Code in their products?](https://code.claude.com/docs/en/legal-and-compliance):

> "Unless we've mutually agreed otherwise, preinstalling or running Claude Code in your products or services ... requires agreeing to our Commercial Terms of Service and complying with the conditions below:
> - **The Claude Code binary must not be modified.** ... customers may not remove, disable, or restrict any authentication method built into it (including methods that permit signing in with a Claude account or the user's own API key).
> - **Customers may not pay for, resell, or intermediate Claude usage on their end users' behalf.** Each end user must authenticate with their own Anthropic API key, Claude subscription plan credentials, or 3P inference provider credential ..."

Also on that page: "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK." Free, Pro, and Max users fall under the Consumer Terms. Team, Enterprise, and API users fall under the Commercial Terms.

**Consumer Terms** (effective 2025-10-08), [anthropic.com/legal/consumer-terms](https://www.anthropic.com/legal/consumer-terms):

- Prohibited use: "Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, to access the Services through automated or non-human means, whether through a bot, script, or otherwise."
- Credentials: "You may not share your Account login information, Anthropic API key, or Account credentials with anyone else."

Inferred: the Claude Code docs and the support articles that describe `claude -p` and the Agent SDK on plan limits are the "explicitly permit" exception for the user's own scripted use of Claude Code.

### What this means for `dear_reviewer` (inferred unless marked)

| Pattern | Status |
| --- | --- |
| A "Sign in with Claude" button, or your own OAuth client against claude.ai | **Prohibited** ("offer Claude.ai login into their own applications"). |
| Reading the `Claude Code-credentials` Keychain item, or calling the Messages API with the user's OAuth token | **Prohibited** ("collect, store, or intermediate") and **technically blocked** (see enforcement below). |
| Asking the user to paste a `setup-token` into the app | **Prohibited** (collecting and storing a Claude.ai credential). |
| A hosted service that runs Claude on the developer's or a shared subscription | **Prohibited** ("route requests ... on behalf of their users"; "pay for, resell, or intermediate"). |
| User-run MCP server, plugin, or MCPB that the user's own Claude Code or Desktop calls | **Allowed**. The user is running a native Anthropic app on their own login. |
| App spawns the user's own installed, unmodified `claude -p`, user logged in through Anthropic's flow, app never touches credentials | **Gray, leaning allowed.** It fits the "end user ... unmodified Claude Code binary" carve-out, and support says `claude -p` and "third-party apps" draw from plan limits. But it's still "a product ... that interact[s] with Claude's capabilities", and the SDK note requires approval for products offering "claude.ai login or rate limits". Get written confirmation before relying on it. |
| App built on the Agent SDK (bundled binary) using the user's login | **Requires prior approval** per the SDK docs, as written. |
| App using the user's own API key (Console or Bedrock/Vertex/Foundry) | **Allowed**, and the documented path. |

Team and Enterprise: the sentence about routing names only "Free, Pro, or Max plan credentials", and Team/Enterprise run under the Commercial Terms. Whether the routing prohibition applies equally to Team/Enterprise seats is unverified. Ask Anthropic if the target users are on company plans.

### Enforcement timeline, 2025–2026

- **2026-01-08/09.** Anthropic staff: "Yesterday we tightened our safeguards against spoofing the Claude Code harness after accounts were banned for triggering abuse filters from third-party harnesses using Claude subscriptions" ([Thariq Shihipar, X, 2026-01-09](https://x.com/trq212/status/2009689809875591565); text retrieved through the api.fxtwitter.com mirror, which is secondary). Secondary: VentureBeat reports OpenCode-style tools "sen[t] headers that mimicked the official Claude Code" CLI ([VentureBeat, 2026-01-09](https://venturebeat.com/technology/anthropic-cracks-down-on-unauthorized-claude-usage-by-third-party-harnesses)).
- **Error seen by non-Claude-Code callers.** Reported as "This credential is only authorized for use with Claude Code and cannot be used for other API requests". Secondary: issue mirrors at claudeissues.com list several anthropics/claude-code issues with that text. I didn't verify the exact current server message.
- **2026-02 (secondary).** Press reports that the Legal and compliance page was updated to make the OAuth restriction explicit ([alternativeto.net, 2026-02](https://alternativeto.net/news/2026/2/anthropic-officially-bans-using-subscription-authentication-for-third-party-claude-use)). The current page text is quoted above. The change date is unverified because the Wayback Machine was offline.
- **2026-04-04 (secondary).** Third-party harnesses such as OpenClaw stopped counting against subscription limits and moved to pay-as-you-go extra usage. Quote attributed to Boris Cherny: "Our subscriptions weren't built for the usage patterns of these third-party tools" ([implicator.ai, 2026-04-04](https://www.implicator.ai/anthropic-cuts-openclaw-from-claude-subscriptions-citing-unsustainable-compute-costs/)). I found no primary announcement text, so this is unverified.
- **2026-05-13.** Official: "Starting June 15, paid Claude plans can claim a dedicated monthly credit for programmatic usage. The credit covers usage of: Claude Agent SDK, claude -p, Claude Code GitHub Actions, Third-party apps built on the Agent SDK" ([@ClaudeDevs](https://x.com/ClaudeDevs/status/2054610152817619388), retrieved through the fxtwitter mirror).
- **2026-06-15.** Official: "We've paused the previously-announced changes to Claude Agent SDK usage. For now, nothing has changed" ([support 15036540](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)).
- **2026-10-07.** Official: Max and Team plans get monthly API credits ($100/$200 for Max 5x/20x; $20/$100 per Team Standard/Premium seat, pooled and capped at $500). The credits cover the API, Managed Agents, and the Agent SDK *when used with an API key from the linked Console org*. They don't cover interactive Claude Code. Pro and Enterprise aren't eligible ([support 17154008](https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans)). This gives Max and Team users a sanctioned way to fund an app's API-key mode from their subscription.

Expect more changes (inferred): Anthropic has changed this area roughly every two months in 2026, and its docs reserve enforcement "without prior notice". Build subscription mode so it can be switched off.

---

## 8. macOS packaging practicalities

### Finding `claude` from a GUI app (the PATH problem)

- Documented install locations:
  - Native installer: `~/.local/bin/claude`, a symlink into `~/.local/share/claude/versions/`.
  - Homebrew cask: `/opt/homebrew/bin/claude` on Apple silicon (observed on this machine; `/usr/local/bin` on Intel is inferred).
  - npm global: the npm prefix's `bin`.

  Sources: [Setup: Auto-updates](https://code.claude.com/docs/en/setup#auto-updates); [Troubleshoot install: Verify your PATH](https://code.claude.com/docs/en/troubleshoot-install).
- Documented: "a terminal inside an editor takes its PATH from the editor" ([Troubleshoot install](https://code.claude.com/docs/en/troubleshoot-install)). The VS Code extension "bundles a private copy of the CLI ... and does not add it to PATH" (same page).
- Inferred and unverified on this machine (`launchctl getenv PATH` returned nothing): apps launched from Finder or the Dock get launchd's minimal PATH, not the shell's. So `Process` with `/usr/bin/env claude` will usually fail.
- Practical resolution order (inferred):
  1. A path the user chose in Settings, stored as a bookmark.
  2. Probe known locations: `~/.local/bin/claude`, `/opt/homebrew/bin/claude`, `/usr/local/bin/claude`, `~/.npm-global/bin/claude`, `~/.claude/local/claude`. This mirrors the Python SDK's own probe list, plus Homebrew.
  3. As a last resort, ask the login shell (`$SHELL -lic 'command -v claude'`) for the *path only*, then exec that path with a clean env, so you don't inherit `ANTHROPIC_API_KEY`.
- Verify the binary with `claude --version` and, optionally, `codesign --verify` (it's "signed by 'Anthropic PBC' and notarized by Apple") ([Setup: Platform code signatures](https://code.claude.com/docs/en/setup#platform-code-signatures)).

### App Sandbox and the Mac App Store

- Documented (Apple): Mac App Store apps "must be appropriately sandboxed" (2.4.5(i)). They "may not download or install standalone apps ... additional code" (2.4.5(iv)). They must update only through the MAS (2.4.5(vii)). They "may not ... execute code which introduces or changes features or functionality of the app" (2.5.2). Source: [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).
- Documented (Apple): an embedded command-line helper in a sandboxed app is signed with exactly `com.apple.security.app-sandbox` and `com.apple.security.inherit`, so it runs inside the app's sandbox ([Embedding a command-line tool in a sandboxed app](https://developer.apple.com/documentation/xcode/embedding-a-helper-tool-in-a-sandboxed-app)).
- Inferred consequences:
  - A sandboxed app can't read `~/.local/bin/claude` or `~/.claude/` without a user-granted security-scoped bookmark.
  - Any child it spawns runs under the sandbox, so the user's `claude` couldn't use its `~/.claude` state, update itself, or freely read and write the user's repositories.
  - Keychain items are separated by access group or ACL, so a sandboxed process presenting a different code signature most likely couldn't read `Claude Code-credentials` silently.
  - Bundling and re-signing Claude Code with `inherit` entitlements would conflict with "The Claude Code binary must not be modified" in spirit (re-signing changes the signature), and with Claude Code's own auto-updater.
  - Bottom line: **ship outside the Mac App Store**, with Developer ID signing, notarization, the hardened runtime, and no App Sandbox.

### Bundling vs. requiring a user install

| | Bundle the `claude` binary (or the Agent SDK's) | Require the user's install |
| --- | --- | --- |
| Terms | "preinstalling or running Claude Code in your products" requires the Commercial Terms, an unmodified binary, and every auth method left intact ([Legal](https://code.claude.com/docs/en/legal-and-compliance)) | User-run Claude Code; matches the end-user carve-out |
| Subscription login | Same Keychain item only if `CLAUDE_CONFIG_DIR` is left alone. Your copy could trigger a fresh login, which must still be Anthropic's own flow | Already logged in |
| Updates | You ship updates. Server-side changes can break old versions, for example "A newly launched model can require a Claude Code version newer than the stable channel serves" ([Setup](https://code.claude.com/docs/en/setup#configure-release-channel)) | Native install auto-updates. Homebrew doesn't by default ([Setup](https://code.claude.com/docs/en/setup#update-claude-code)) |
| Size | npm metadata shows per-platform native packages; size not measured here | None |
| Recommendation | For API-key mode only, if at all | **Preferred** for subscription mode |

---

## 9. Comparison of approaches

| Approach | Billing source | ToS status | Robustness | Sandbox / MAS |
| --- | --- | --- | --- | --- |
| **A. Spawn the user's installed `claude -p` (stream-json)**, no credential handling | User's plan limits if logged in with a plan. API if an `ANTHROPIC_API_KEY`/helper is present | Gray, leaning allowed (end-user unmodified-binary carve-out; support says `-p` and third-party apps use plan limits). SDK note says products need approval. Get written OK | Good. Documented, versioned flags; `system/init` exposes a `capabilities` array for feature detection ([headless](https://code.claude.com/docs/en/headless#read-session-metadata)). Risks: `--bare` default change, CLI flag drift, PATH discovery | Not MAS-compatible. Works with Developer ID, unsandboxed |
| **B. Agent SDK (TS/Python) with bundled binary, user's Keychain login** | Plan limits (tagged `sdk-ts`/`sdk-py`) | "Unless previously approved ... does not allow" | Good API, but adds a Node or Python runtime to a Swift app | Same as A, plus bundling rules |
| **C. Agent SDK or CLI with user's API key** (incl. Max/Team monthly API credit) | Console org (pay per token, or the plan's API credit) | **Allowed**; the documented path | High | Same as A |
| **D. MCP server / Claude Code plugin the user adds** | User's Claude Code session, so plan limits | **Allowed** | High. Uses the public MCP interface. UX lives in Claude Code | Server can be a separate unsandboxed helper; the app itself could be sandboxed if it only shares data through files or XPC (inferred) |
| **E. Claude Desktop extension (MCPB)** | Claude Desktop, so plan limits | **Allowed** | High. Directory listing deprecated, so users install the file themselves | Same as D |
| **F. Pose as an IDE (`~/.claude/ide/*.lock` + WebSocket MCP)** | User's Claude Code session, so plan limits | Not prohibited by text, but imitates a first-party client. Avoid | Low. Internal protocol, schema not publicly specified | N/A |
| **G. `setup-token` pasted into app, or reading the Keychain, then calling the API or CLI** | Plan | **Prohibited** (collect, store, intermediate) | Breaks when tokens rotate, and risks the user's account | N/A |
| **H. Direct Messages API with OAuth token / spoofed Claude Code headers** | Plan | **Prohibited; actively blocked** since 2026-01 | Broken | N/A |

---

## Could not verify

- Whether Anthropic considers approach A (a distributed app spawning the user's own `claude -p`) to be "offering ... rate limits for their products". I found no primary statement either way, and the GitHub question is unanswered ([#382](https://github.com/anthropics/claude-agent-sdk-typescript/issues/382)).
- Whether the routing prohibition ("Free, Pro, or Max plan credentials") applies identically to Team and Enterprise seats.
- The primary text and exact scope of the 2026-04-04 OpenClaw / third-party harness billing change, and whether it was reversed (secondary sources disagree).
- The date the Legal and compliance page gained the OAuth language (press says 2026-02; the Wayback Machine was offline).
- The exact current server error string for non-Claude-Code use of subscription tokens.
- The `~/.claude/ide/<port>.lock` JSON schema, and whether Anthropic supports third-party IDE implementations.
- The exact PATH a Finder-launched app gets on macOS 26 (`launchctl getenv PATH` returned nothing in this environment).
- Whether `--setting-sources user` keeps a `-p` run from connecting a project's `.mcp.json` servers.
- Whether a sandboxed process can read the `Claude Code-credentials` Keychain item (expected not to; not tested, by design).
- On-disk size of the bundled per-platform Claude Code binaries.

---

## Sources

Anthropic: Claude Code and Agent SDK docs (code.claude.com, retrieved 2026-10-12)

- Authentication: https://code.claude.com/docs/en/authentication (sections: Log in, Credential management, Authentication precedence, Generate a long-lived token, Restrict login to your organization, Anthropic profiles)
- Legal and compliance: https://code.claude.com/docs/en/legal-and-compliance (Authentication and credential use; Can customers offer Claude Code in their products?; Acceptable use)
- Run Claude Code programmatically (headless): https://code.claude.com/docs/en/headless
- CLI reference: https://code.claude.com/docs/en/cli-reference
- Environment variables: https://code.claude.com/docs/en/env-vars (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`)
- Agent SDK overview: https://code.claude.com/docs/en/agent-sdk/overview
- Agent SDK quickstart: https://code.claude.com/docs/en/agent-sdk/quickstart
- MCP: https://code.claude.com/docs/en/mcp
- Channels: https://code.claude.com/docs/en/channels
- VS Code (built-in IDE MCP server): https://code.claude.com/docs/en/vs-code (fetched via /ide-integrations)
- Advanced setup: https://code.claude.com/docs/en/setup
- Troubleshoot installation and login: https://code.claude.com/docs/en/troubleshoot-install
- Error reference: https://code.claude.com/docs/en/errors

Anthropic: Claude connectors docs

- Build a desktop extension with MCPB: https://claude.com/docs/connectors/building/mcpb

Anthropic: help center (support.claude.com)

- Use the Claude Agent SDK with your Claude plan (updates 2026-06-15, 2026-10-07): https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
- Monthly API credits for Max and Team plans: https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans
- Use Claude Code with your Pro or Max plan: https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan

Anthropic: legal

- Consumer Terms of Service (effective 2025-10-08): https://www.anthropic.com/legal/consumer-terms
- Commercial Terms of Service (referenced, not re-read): https://www.anthropic.com/legal/commercial-terms

Anthropic: packages and source

- `@anthropic-ai/claude-code` 2.1.296 (npm metadata: per-platform optional deps, `bin: claude`)
- `@anthropic-ai/claude-agent-sdk` 0.3.296 tarball: `sdk.mjs` (Keychain service `Claude Code-credentials`, `CLAUDE_CODE_ENTRYPOINT="sdk-ts"`, binary resolution), `sdk.d.ts` (`env` option, `CLAUDE_AGENT_SDK_CLIENT_APP`), `README.md`
- `claude-agent-sdk` (Python) 0.2.165 on PyPI; source `src/claude_agent_sdk/_internal/transport/subprocess_cli.py` @ `dbc975eb2771acac751258a8c3b08100cdc54a50`: https://github.com/anthropics/claude-agent-sdk-python/blob/dbc975eb2771acac751258a8c3b08100cdc54a50/src/claude_agent_sdk/_internal/transport/subprocess_cli.py
- GitHub issues: https://github.com/anthropics/claude-agent-sdk-typescript/issues/382 ; https://github.com/anthropics/claude-code/issues/82266

Anthropic: official social posts (text retrieved through the api.fxtwitter.com mirror)

- Thariq Shihipar, 2026-01-09: https://x.com/trq212/status/2009689809875591565
- @ClaudeDevs, 2026-05-13: https://x.com/ClaudeDevs/status/2054610152817619388

Apple

- App Review Guidelines 2.4.5, 2.5.2: https://developer.apple.com/app-store/review/guidelines/
- Embedding a command-line tool in a sandboxed app: https://developer.apple.com/documentation/xcode/embedding-a-helper-tool-in-a-sandboxed-app

Secondary (labeled where used)

- VentureBeat, 2026-01-09: https://venturebeat.com/technology/anthropic-cracks-down-on-unauthorized-claude-usage-by-third-party-harnesses
- implicator.ai, 2026-04-04: https://www.implicator.ai/anthropic-cuts-openclaw-from-claude-subscriptions-citing-unsustainable-compute-costs/
- alternativeto.net, 2026-02: https://alternativeto.net/news/2026/2/anthropic-officially-bans-using-subscription-authentication-for-third-party-claude-use
- claudeissues.com issue mirrors (error string): https://claudeissues.com/issue/8052-bug-anthropic-api-error-credential-restricted-to-claude-code

Local observation (this machine, 2026-10-12): `claude` 2.1.289 at `/opt/homebrew/bin/claude`; `claude auth status` keys listed (values not recorded); `~/.claude/` file names listed (no `.credentials.json`).
