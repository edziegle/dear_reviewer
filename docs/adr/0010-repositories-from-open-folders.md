---
status: accepted
date: 2026-10-13
---

# Take the Inbox's repositories and clones from the folders the Reviewer opens, and remember them

## Context and Problem Statement

ADRs 0005 and 0006 made two settings the only way into the Inbox. Repositories lists each `owner/name`, and Local Clones maps each one to a path. In the first real run (#18), the Inbox showed empty groups, and opening a pull request failed with an error that asked for a Local Clones entry. The repository was the folder open in that window. The Reviewer expected Dear Reviewer to use the folders already open in VSCodium.

Changes open in the review window (ADR 0002), which never holds the Reviewer's own folders, so the folders of the current window aren't enough. Running git in a folder reads that repository's own config, which can name programs for git to run. The answer therefore also decides where a workspace can make Dear Reviewer run git.

Where do the Inbox's repositories and their clones come from, and what may a workspace decide?

## Considered Options

- Keep the two settings as the only source
- Read the folders open in the current window only
- Read the folders open in each of the Reviewer's windows, and remember them in the extension's global storage
- Also read VS Code's list of recently opened folders
- Clone each repository into the extension's storage

## Decision Outcome

Chosen option: read the folders open in each of the Reviewer's windows, and remember them. Opening a clone in VSCodium is the only setup a repository needs, and the review window still finds the repository and its clone.

### What counts as an open repository

- A workspace folder counts when the window is trusted, and the folder is the top of a git working tree: it has a `.git` entry, and `git rev-parse --show-toplevel` names the folder itself. A folder inside a clone doesn't count, and Dear Reviewer doesn't run git in folders that have no `.git`.
- Folders in the extension's storage don't count. Those are Change worktrees and the review window's home folder.
- A remote is on GitHub when its configured URL, read before any `insteadOf` rewriting, has the GitHub host. The host comes from the user-level GitHub API base URL: `github.com` for `https://api.github.com`, and the server's own host otherwise. HTTPS, SSH and scp-style URLs count.
- The folder adds one repository to the Inbox: its `upstream` remote's on GitHub, else its `origin`'s, else the first one on GitHub. A clone whose `origin` is the Reviewer's fork lists the shared repository, as in ADR 0005.
- Every repository name, from any source, must match `owner/name` made of letters, digits, `_`, `.` and `-`. Anything else is ignored, so a name can't add search qualifiers to the Inbox's GitHub search.

### What is remembered, and how it's forgotten

- Each window remembers its open repositories in `repositories.json` in the extension's global storage. Each repository has one clone, and the clone seen last wins.
- Locate Clone and Add Repository remember a folder the Reviewer picks. Locate Clone only takes a folder at the top of a git repository with a remote that names the repository. Add Repository only takes a folder with a remote on GitHub.
- Forget Repository removes a remembered repository. A repository open in the current window comes back when the window's folders change, and the picker says so.
- VS Code's recently opened folders aren't read. VS Code only offers that list through an internal command, and it includes folders that were never trusted or no longer exist.

### Which clone is used

The Inbox lists the Repositories setting's repositories, the ones open in this window, and the remembered ones. A repository's clone comes from the first of these that has one:

1. The Local Clones setting, read from user settings only.
2. A folder open in this window with a remote that names the repository.
3. A remembered clone that still exists.

When none has a clone, opening a pull request offers Locate Clone… and Open Settings, then opens the pull request in the folder the Reviewer picks. When the fetch fails, the error offers Locate Another Clone…. The Inbox's local branches (ADR 0006) come from the same clones.

### What a workspace may decide

- A workspace may decide which `owner/name` the Inbox lists: through the Repositories setting at any scope, and through the remotes of the folders it opens.
- A workspace never decides the GitHub API base URL, where the token goes, the path to `claude`, or Local Clones. They stay user-level only, and are restricted settings in untrusted workspaces.
- Dear Reviewer runs git only in folders the Reviewer opened in a trusted window, folders the Reviewer picked, and the user-level Local Clones. A workspace that lists a repository gets no clone for it this way. An untrusted window's folders aren't read at all, because git can run programs that a repository's own config names, such as `core.fsmonitor` and `core.sshCommand`.

### Trusting the review window

The review window's folders, the Change worktrees, live in the extension's global storage, which the Reviewer has never trusted. The review window therefore opens in Restricted Mode, and language servers and navigation, the reason Dear Reviewer exists, are off. An extension can't grant trust.

When the review window opens untrusted, Dear Reviewer explains this and offers Manage Workspace Trust. That button copies the storage folder's path and opens VS Code's trust editor, so the Reviewer can trust that folder once for every later Change. Trusting it also lets the workspace settings and tasks of the reviewed code apply in that window, and lets other extensions act on that code as on any trusted folder. That code may be a teammate's or an agent's. Dear Reviewer's own behaviour doesn't change, because it reads only user-level settings. Leaving the review window in Restricted Mode was rejected, because it turns off navigation. Asking for trust per Change was rejected, because every Change is a new folder, and that would mean a prompt per Change.

### Empty Changes

A Change whose head has no commits that its base lacks is refused before any worktree is made, so no entry is left behind.

### Consequences

- Good, because opening a clone in VSCodium is all the setup a repository needs, for its pull requests and its local branches.
- Good, because the review window's Inbox keeps working with nothing configured.
- Good, because a missing clone leads to a folder picker that remembers the answer, not only to an error about a setting.
- Good, because a workspace still can't redirect the token, choose `claude`, or point git at a folder the Reviewer didn't open or pick.
- Bad, because remembered repositories stay in the Inbox after the Reviewer stops working on them, until they use Forget Repository.
- Bad, because a repository with two clones uses whichever was seen last, unless Local Clones names one.
- Bad, because an untrusted window adds nothing to the Inbox; its welcome message says why.
- Bad, because trusting the storage folder applies to every Change the review window opens, whoever wrote the code.
- Bad, because a folder open below the top of its clone, such as one package of a monorepo, doesn't count; Add Repository can pick the clone's top folder.
