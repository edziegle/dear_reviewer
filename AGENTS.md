## Tooling

This is a mise shop. `mise.toml` pins the tools (Node, Vale) and holds every project command as a task: list them with `mise tasks`, run them with `mise run <task>`. Add new project commands as mise tasks too; npm and uv are for dependency management, and an npm script exists only where a tool such as `vsce` requires one. When `mise` can't run (some sandboxes block it), run the task's `run` commands from `mise.toml` in its `dir`.

`mise run test` runs every integration suite in VSCodium and ends with a list of every failure. Narrow a test-first loop with these environment variables, alone or together, on `mise run test` or on `node out/test/run.js` in `extension/` after `npx tsc -p test`:

- `DEAR_REVIEWER_SUITES=review,inbox`: whole suites, each a folder in `extension/test/suite/`, with its later phases such as `review/afterReload`.
- `DEAR_REVIEWER_FILES=review/comments,inbox/settings.test.ts`: test files, by path from `test/suite/`, narrowing their suite even when `DEAR_REVIEWER_SUITES` names it. The phases before a file's phase also run, since they set up its state; the phases after it don't.
- `DEAR_REVIEWER_GREP='pending review'`: a regular expression for Mocha's `--grep`, applied in every phase that runs.

Test runs on this machine take turns, so a run can first print that it's waiting for another worktree's (ADR 0028).

## Agent skills

### Issue tracker

Issues live in GitHub Issues for edziegle/dear_reviewer, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label names: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `GLOSSARY.md` plus `docs/adr/`. See `docs/agents/domain.md`.
