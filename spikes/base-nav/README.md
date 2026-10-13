# Spike: navigation on both sides of a review diff

Question: if each Change gets two worktrees (base and head) added as workspace folders, and the diff is opened between real `file:` URIs, does go to definition work on **both** sides? See `docs/adr/0001-vs-code-extension.md`.

## Automated check

```sh
npm install
npm test
```

This runs inside the locally installed VSCodium (`/Applications/VSCodium.app`; override with `CODIUM_APP`). It installs basedpyright and the Python extension it depends on from Open VSX into an isolated extensions folder under `.vscode-test/`. It builds a two-commit Python repo in which `old_helper` is renamed to `new_helper`, opens that Change, and asks the language server for the definition of the call on each side. It passes only if the base side lands in the base worktree's `util.py` and the head side lands in the head worktree's `util.py`. The result is written to `.vscode-test/work/result.json`.

## Manual check on a real repo

```sh
codium --extensionDevelopmentPath="$PWD" path/to/any.code-workspace
```

Open a multi-root `.code-workspace`, not a plain folder. Adding folders to a single-folder window turns it into a workspace and restarts the extension host. Then run **Dear Reviewer Spike: Open Change**, pick the repo, and enter base and head refs. Cmd+click on both sides of the diffs. Run **Dear Reviewer Spike: Close Change** to remove the worktrees.
