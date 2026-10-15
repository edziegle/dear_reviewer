---
status: accepted
date: 2026-10-13
---

# Review pull requests in a configured local clone of their repository

Amended by [ADR 0010](0010-repositories-from-open-folders.md): a repository's clone also comes from a folder open in the Reviewer's windows, or one they picked, and Dear Reviewer remembers it. `dearReviewer.localClones` is optional and takes precedence. A missing clone offers a folder picker instead of only pointing at the setting.

## Context and Problem Statement

Opening a pull request from the Inbox makes it a Change, which needs a base and a head worktree. Worktrees belong to a local repository, and the pull request's head commit has to be fetched into that repository first. The Inbox only knows repositories as `owner/name` on GitHub (the Repositories setting), and the spec doesn't say how `owner/name` maps to a clone on disk. The work monorepo is large, and the Reviewer already has it cloned on each machine. Where does Dear Reviewer fetch a pull request, and from which remote?

## Considered Options

- A user setting that maps each `owner/name` to the path of its local clone
- Find the clone among the window's workspace folders by their remote URLs
- Clone each repository into the extension's storage the first time one of its pull requests is opened

## Decision Outcome

Chosen option: a user setting, `dearReviewer.localClones`, because it is explicit, works from the review window (which never holds the Reviewer's own folders), and reuses the clone the Reviewer already has, so a large monorepo is not cloned again.

- Keys are `owner/name` and are matched without regard to case, as GitHub matches them. Values are absolute paths. The setting has `machine` scope, so the work machine and the home machine each keep their own paths.
- As with the API base URL and the path to `claude`, it is read only from user settings and is a restricted setting in untrusted workspaces, so a workspace can't choose the repository Dear Reviewer runs git in.
- Dear Reviewer fetches from the clone's remote whose URL ends in `owner/name` (with or without `.git`), and falls back to `origin`. A clone whose `origin` is the Reviewer's fork and whose `upstream` is the shared repository fetches from `upstream`, which is the only one that has `refs/pull/<n>/head`.
- One fetch takes `refs/pull/<n>/head`, without writing a ref for it, and the base branch into its remote-tracking ref (`refs/remotes/<remote>/<base>`), as a plain `git fetch` would. The Change runs from the merge base of that base branch and the fetched head. The worktrees keep the head commit from garbage collection while the Change is open.
- A pull request's Change records the pull request, and the pull request is part of the Change's identity, so it never shares worktrees or state with a local Change of the same commits. Its viewed files are GitHub's own viewed state, and closing the Change leaves that state on GitHub.

### Consequences

- Good, because the Reviewer's existing clone, its objects and its credentials are reused; nothing large is downloaded twice.
- Good, because forks work without extra configuration in the common `origin`/`upstream` layout.
- Bad, because the Reviewer must add an entry per repository before its pull requests open. Dear Reviewer says so, and offers to open the setting, when one is missing.
- Bad, because the fetch updates the clone's remote-tracking ref for the base branch, and the Change's worktrees appear in `git worktree list` of the Reviewer's clone.
- Bad, because a fetch that needs interactive credentials fails rather than prompting; it relies on the clone's credential helper or SSH agent.
