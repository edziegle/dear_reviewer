## Tools

This is a mise shop. `mise.toml` pins the tools (Node, Vale) and holds every project command as a task: list them with `mise tasks`, run them with `mise run <task>`. Add new project commands as mise tasks too; npm and uv are for dependency management, and an npm script exists only where a tool such as `vsce` requires one. When `mise` can't run, run the task's `run` commands from `mise.toml` in its `dir`.

## Tests

Pure logic gets unit tests; integration tests cover behaviour in the extension host.

Unit tests live in `extension/test/unit/`, and the test runner's beside it in `extension/test/`. They import the modules they test directly and run under plain Node with `mise run test-unit [name]`, where `name` picks one file such as `prompts` for `prompts.test.ts`. A module they load must not import `vscode` at runtime, so move pure logic out of a module that does rather than mocking `vscode`.

`mise run test` runs the unit tests, then `mise run test-integration`, which runs every integration suite in VSCodium and ends with a list of every failure, grouped by suite. VSCodium needs a display, so in the sandbox put `xvfb-run -a` in front of either command: `xvfb-run -a mise run test-integration`.

A **run** is one `mise run test-integration`, which holds the lock (ADR 0028). A **launch** is one VSCodium start, which runs phases one after another; a suite's **phase** is a folder of tests, such as `review` or `review/afterReload`, which reopens the workspace as a window reload does. `launchGroups` in `extension/test/run.ts` lists the launches (ADR 0039): `singleFolder` and `inbox` have their own; the reload suites run in a chain, each launch running the `afterReload` phase of one suite and then the first phase of the next; the multi-root suites run at the end of the chain; `openFolders` and its `elsewhere` phase come last. Suites in a launch share a window, so a suite leaves no Change open, setting changed or folder added behind it, except what a reload suite hands to its `afterReload` phase. If the extension host crashes partway through a launch, the suite that crashed it fails and the suites after it are listed as not run. Nothing reruns. CI runs the two as separate jobs, and the integration tests only on pull requests, on Linux (ADR 0035). Narrow a test-first loop with these environment variables, alone or together, on `mise run test-integration` or on `node out/test/run.js` in `extension/` after `npx tsc -p test`:

- `DEAR_REVIEWER_SUITES=review,inbox`: whole suites, each a folder in `extension/test/suite/`, with its later phases such as `review/afterReload`; the launches that hold them still run, with only those phases in them.
- `DEAR_REVIEWER_FILES=review/comments,inbox/settings.test.ts`: test files, by path from `test/suite/`, narrowing their suite even when `DEAR_REVIEWER_SUITES` names it. The phases before a file's phase also run, since they set up its state; the phases after it don't.
- `DEAR_REVIEWER_GREP='pending review'`: a regular expression for Mocha's `--grep`, applied in every phase that runs.

Test runs on this machine take turns, so a run can first print that it's waiting for another worktree's (ADR 0028). Start a run of every suite in the background: waiting its turn and then running can outlast a foreground command.

Rules for tests, which reviewers enforce:

- A test that fails in CI is a bug report. No mocha retries and no skipped flaky tests. One human re-run of a CI job can unblock a merge, but only if an issue labeled `flaky` is filed that names the failing test.
- A test waits for what it checks, with `eventually` or a helper's own wait, and asserts nothing about elapsed time: a loaded machine runs every test slower.
- Each integration test that talks to the Assistant opens a Change of its own, with its own pull request, branch or commit range. The Assistant keeps one conversation for each (ADR 0009), so tests sharing one resume each other's conversation.
- A test scripts the Assistant's replies for the Change it opened with `await scriptClaude(change, script)`, before the turns it scripts begin. The script's turns answer that conversation's next messages in order, starting with the summary of a new conversation, whatever other Changes ask. `await assistantRuns(change)` gives back that conversation's runs since. A Change the Inbox opened from a branch has the branch's conversation, so name the branch as the request's head.
- A test that changes the Claude login with `scriptClaudeLogin` puts the default back when it ends.
- The fake `claude` (`extension/test/fakeClaude.ts`) and the helpers in `extension/test/suite/` name their traps in their doc comments: read them before scripting the Assistant or serving GitHub.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for edziegle/dear_reviewer, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label names: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `GLOSSARY.md` plus `docs/adr/`. See `docs/agents/domain.md`.
