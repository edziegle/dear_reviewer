---
status: accepted
date: 2026-10-19
---

# List each release on Open VSX, from a job that holds only the Open VSX credential

## Context and Problem Statement

A release ends as an attested `dear-reviewer.vsix` on a GitHub Release (ADR 0041), and installing it means downloading the file by hand. VSCodium, the editor the README names first and the integration tests run in, installs from the Open VSX registry. VS Code installs from the VS Code Marketplace, a separate registry with its own account, token and tool. Should a release also go to a registry, and how does the credential that lists it stay out of reach of everything else the release runs?

Listing is hard to undo: Open VSX never accepts a version number twice, and the `edziegle` name on it stays claimed.

## Considered Options

- Keep releasing to GitHub Releases only
- List each release on Open VSX, from a job of its own in `release.yml`
- List on Open VSX by hand, from a laptop

## Decision Outcome

Chosen option: a job of its own in `release.yml`, because merging the `release-please` pull request is already the deliberate act of releasing, and a listing from CI uses the attested file rather than one built on a laptop.

<!-- vale RedHat.Slash = NO -->

- Open VSX only, for now. The VS Code Marketplace is a later decision; a second registry would be a second job beside this one.
- Every release goes to Open VSX with no approval step. The sole maintainer would only approve their own merge.
- Versions below 1.0 are listed as ordinary releases, not pre-releases: the pre-release flag relies on odd and even minor versions, which `release-please` doesn't produce.
- The `open-vsx` job downloads the `vsix` artifact that `build-vsix.yml` built and attested, and runs `gh attestation verify` with `--signer-workflow` and `--source-ref refs/heads/main` on it before installing anything else. The same attested .vsix goes to every registry, as ADR 0041 says, and the job checks that rather than assuming it.
- `ovsx` lives in `tools/ovsx/`, a package of its own with its own `package-lock.json`, installed with `npm ci --ignore-scripts`. The job never installs the extension's build and test tools, so none of those packages run beside the credential.
- The job holds `contents: read`, `attestations: read` and `id-token: write`, and runs in the `open-vsx` environment, which only `main` can deploy to. It holds no `contents: write` or `attestations: write`, so it can't change the GitHub Release or attest a file.
- The job runs after the `publish` job attaches the .vsix to the GitHub Release, so a version on Open VSX, which can never be listed again, is always on GitHub too. The `vsix` artifact is kept for 7 days, not 1, so re-running the failed jobs is the recovery from a failure in either. `ovsx publish --skip-duplicate` makes a re-run after a success do nothing.
- The listing shows the root `README.md`, up to its Development section, and `LICENSE`, copied into `extension/` by `mise run package` and git-ignored there, so the root files stay the only copies. `extension/media/icon.png` is the Reading Cat from the logo.

<!-- vale RedHat.Slash = YES -->

### The credential, in two stages

Open VSX's Trusted Publishing exchanges the job's GitHub OIDC token for one that expires within minutes and can publish only this extension, so nothing long-lived is stored in GitHub. A trusted publisher can only be registered for an extension that already has a version, though, so the first listing needs an access token.

1. Until the first listing, the `open-vsx` environment holds an Open VSX access token as the secret `OVSX_PAT`, and `ovsx` uses it.
2. After the first listing, the maintainer registers a trusted publisher on the Open VSX website for workflow `release.yml` and environment `open-vsx`, then deletes the secret. With no `OVSX_PAT` set and an OIDC token available, `ovsx` uses Trusted Publishing by itself, so the workflow doesn't change.

A registration matches the repository, the workflow file and, if given, the environment, but not the branch or tag, so it names the `open-vsx` environment: the environment's branch rule is what keeps other branches from listing a release.

This amends ADR 0041, which expected this job to hold no `id-token`. With `id-token: write` alone the job can't attest, since that also takes `attestations: write`, and anything it signed would name `release.yml`, which verifiers reject.

### Consequences

- Good, because VSCodium and other editors that use Open VSX install and update the extension from their own extensions view.
- Good, because a swapped file fails the attestation check before `ovsx` is installed, and the credential is never next to the build tools.
- Good, because after the first listing no long-lived credential is stored in GitHub.
- Bad, because VS Code users still download the .vsix from GitHub Releases until the extension is on the VS Code Marketplace.
- Bad, because Open VSX doesn't check the attestation, so a user who installs from it trusts Open VSX's own check of the publisher, as ADR 0041 notes.
- Bad, because 0.5.0 and earlier stay off Open VSX: they were signed by `release.yml`, not `build-vsix.yml`, and were packaged without the README, license or icon. The first listing is the next release.
