---
status: accepted
date: 2026-10-19
---

# Build and attest the .vsix in a reusable workflow, for SLSA Build L3

Amended by [ADR 0043](0043-list-each-release-on-open-vsx.md): the Open VSX job holds `id-token: write`, for Open VSX's Trusted Publishing, and `attestations: read`, to verify the .vsix before it lists it. It still holds no `contents: write` or `attestations: write`.

## Context and Problem Statement

ADR 0027 attests `dear-reviewer.vsix` with GitHub's `actions/attest`, which gives Supply-chain Levels for Software Artifacts (SLSA) Build L2. Two things keep the release from Build L3. The `attest` step runs in `release.yml`, so the certificate names that workflow as the signer, and a verifier can't tell from it that the job that built the .vsix had no `id-token: write`: a tampered `release.yml` could sign anything. And the build restores `~/.npm` and the tools mise installs from caches that the CI workflow writes on `main`, so one build can change another. The integrity hashes in `package-lock.json` limit the damage, but that isn't isolation.

ADR 0027 rejected Build L3 because it meant adopting `slsa-github-generator`. That project's README says it's no longer maintained, as of August 2026, and points to GitHub artifact attestations. GitHub now documents the Build L3 route with those: build and attest inside a reusable workflow, and verify with `--signer-workflow`. Should a release reach Build L3 (issue #57)?

## Considered Options

- Stay at Build L2, as ADR 0027 decided
- `actions/attest` in a reusable workflow that builds and attests the .vsix, verified with `--signer-workflow`
- `slsa-github-generator`'s reusable workflows

## Decision Outcome

Chosen option: `actions/attest` in a reusable workflow, because it reaches Build L3 with the action the release already uses, and adds no dependency.

`.github/workflows/build-vsix.yml` builds and attests the .vsix, and `release.yml` calls it by local path after `release-please` creates a release. The certificate then names `build-vsix.yml` as the signer, and a user verifies a download with:

```sh
gh attestation verify dear-reviewer.vsix -R edziegle/dear_reviewer \
  --signer-workflow edziegle/dear_reviewer/.github/workflows/build-vsix.yml
```

The build runs inside the reusable workflow too: a workflow that only signs vouches for a file its caller built.

<!-- vale RedHat.Slash = NO -->

- What still holds from ADR 0027: every release attests its .vsix; every action is pinned to a full commit SHA; the build and the signing are separate jobs, so no install script can sign a file of its own; and the same attested .vsix goes to every registry, not a rebuild.
- Inside `build-vsix.yml`, the `vsix` job builds with `contents: read` only, and the `attest` job, which runs no dependency code, downloads the .vsix and attests it. The calling job in `release.yml` grants `contents: read`, `id-token: write` and `attestations: write`, since a reusable workflow gets no more than its caller grants.
- The release build restores no cache: no `actions/cache` for `~/.npm`, and `cache: false` on `mise-action`, whose own cache the CI workflow's `build` job writes under the same key. The CI workflow keeps its caches.
- Attaching the .vsix to the release stays in `release.yml`, in a `publish` job that alone holds `contents: write`, and restores no cache either.
- The build checks out the release's tag, not the commit whose push started the run. A push just before the release PR merges starts a run whose `release-please` finds the new release, and that commit still has the old version: v0.9.0 went out as a 0.8.1 .vsix that way, and both registries skipped it as a duplicate. Starting `release.yml` by hand with a tag builds and lists that release again. It runs on `main` only, for a version tag that has a published GitHub Release. Since anyone who can push can make a tag on any commit, the build fails unless the tag's commit is on `main` and its `package.json` holds the tag's version. That check is written into `build-vsix.yml` and runs before mise loads the tag's `mise.toml`, so the tag can't change it.
- `slsa-github-generator` is unmaintained, has to be referenced by tag, against the rule that pins every action to a commit SHA, and moves verification from `gh` to `slsa-verifier`.

<!-- vale RedHat.Slash = YES -->

This supersedes ADR 0027.

### Consequences

- Good, because a verifier can tell from the certificate that the .vsix was built and signed by `build-vsix.yml`, not by whatever calls it.
- Good, because a cache written by another run can't change a release's .vsix.
- Bad, because the release build downloads every npm package and Node itself each time, so it's slower.
- Bad, because Open VSX doesn't check or show SLSA provenance, so the attestation protects downloads from GitHub Releases only; an install from a registry rests on the registry's own checks of the publisher.
- Bad, because when the extension goes to Open VSX, `ovsx publish` is npm code too, and needs a job of its own that holds only the Open VSX token, with no `id-token` or `contents: write`.
