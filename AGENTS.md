## Tooling

This is a mise shop. `mise.toml` pins the tools (Node, Vale) and holds every project command as a task: list them with `mise tasks`, run them with `mise run <task>`. Add new project commands as mise tasks too; npm and uv are for dependency management, and an npm script exists only where a tool such as `vsce` requires one. When `mise` can't run (some sandboxes block it), run the task's `run` commands from `mise.toml` in its `dir`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for edziegle/dear_reviewer, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label names: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `GLOSSARY.md` plus `docs/adr/`. See `docs/agents/domain.md`.
