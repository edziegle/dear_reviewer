---
status: accepted
date: 2026-10-13
---

# List local branches from the configured local clones, ahead of the remote's default branch

## Context and Problem Statement

The Inbox lists local branches that are ahead of main, such as an agent's branch, so the Reviewer can open one as a local Change (#6). Dear Reviewer has to know which repositories on disk to look in, and what "main" is in each one. Repositories are named by the Repositories setting as `owner/name`, and ADR 0005 maps each one to a local clone in `dearReviewer.localClones`. Which repositories does the Inbox scan, and which ref counts as main?

## Considered Options

- Scan the clones in `dearReviewer.localClones` of the repositories in the Repositories setting
- A second setting that lists local repositories to scan, separate from the pull request clones
- Scan the window's workspace folders

## Decision Outcome

Chosen option: scan the configured local clones, because they are the repositories the Reviewer already named as theirs on this machine. Agents usually work in a worktree or branch of that same clone, so its branches are where their work shows up. The review window never holds the Reviewer's own folders, so workspace folders aren't an option.

- A repository is scanned only if it is in the Repositories setting and has an entry in `dearReviewer.localClones`. The setting is read only from user settings, as in ADR 0005. A clone listed for two repositories is scanned once.
- Main is the default branch of the clone's remote for the repository: the remote whose URL names `owner/name`, or else `origin` (as in ADR 0005), and the ref that `refs/remotes/<remote>/HEAD` points at. If that ref is missing, main is `<remote>/main`, then `<remote>/master`, then the local `main`, then the local `master`.
- A branch is listed with the number of commits it has that main doesn't (`git rev-list --count main..branch`). Branches with none are left out, and so is the local branch with the same name as main.
- Opening a branch opens a local Change from the merge base of main and the branch to the branch's head.
- The Inbox shows the "Local branches" group only when at least one Inbox repository has a local clone. A clone that can't be read appears as a problem entry in the group, and the other clones are still listed.
- Branches are read from what the clone already has; listing them never fetches. The count is as fresh as the clone's last fetch of main.

### Consequences

- Good, because there is one setting per repository for both pull requests and local branches.
- Good, because comparing against the remote's default branch matches what a pull request from the branch would contain, and forks in the `origin`/`upstream` layout work the same way as in ADR 0005.
- Bad, because a repository that isn't on GitHub can't be listed: its branches only show up if it has an `owner/name` entry in both settings. A separate setting for local-only repositories could be added later.
- Bad, because commits on the local `main` that haven't been pushed count as ahead on every branch built on them.
- Bad, because a clone that hasn't fetched for a while shows counts against an old main.
