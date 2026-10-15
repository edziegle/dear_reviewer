---
status: accepted
date: 2026-10-14
---

# Attest the .vsix's build provenance and pin actions to commits

## Context and Problem Statement

The release workflow builds `dear-reviewer.vsix` and attaches it to a GitHub Release, and people install that file by hand. Nothing lets them check that the file came from this repository's workflow: anyone who can replace a release asset can replace the extension. The workflows also name each action by a version tag, which its owner can move to other code. The extension will go to the VS Code Marketplace and Open VSX later, but isn't published to either yet. How much supply-chain assurance should a release carry now?

## Considered Options

- Nothing beyond GitHub Releases
- Supply-chain Levels for Software Artifacts (SLSA) build provenance from GitHub's `actions/attest`, about SLSA Build L2
- SLSA Build L3 from `slsa-github-generator`'s isolated reusable workflows

## Decision Outcome

<!-- vale RedHat.Slash = NO -->
Chosen option: `actions/attest`, because it's one step and two job permissions, with no keys or secrets, and it lets anyone verify a downloaded .vsix with `gh attestation verify dear-reviewer.vsix -R edziegle/dear_reviewer`. Build L3 hardens the build against a tampered workflow run, which matters less than letting people verify the file at all, and it moves the build into a reusable workflow the project would have to maintain.
<!-- vale RedHat.Slash = YES -->

- The `vsix` job builds the .vsix with read-only permissions. A separate `publish` job, which runs no dependency code, attests it and then attaches it to the release, so no install script can sign a file of its own, and a failed attestation leaves the release without an unattested file.
- Every action in both workflows is pinned to a full commit SHA, with its version in a comment, which Dependabot keeps up to date.
- When the extension goes to the marketplaces, the same attested .vsix goes to each registry, not a rebuild, and Build L3 is worth a second look.

### Consequences

- Good, because a user can check a .vsix came from this repository's release workflow at a known commit.
- Good, because a moved tag can't change what the workflows run.
- Bad, because provenance says where the .vsix was built, not that its dependencies are safe.
- Bad, because a pinned action needs a Dependabot pull request for every release, not just each major version.
