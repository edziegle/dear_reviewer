---
status: accepted
date: 2026-10-20
---

# List each release on the VS Code Marketplace, signed in as an Azure managed identity

## Context and Problem Statement

ADR 0043 lists each release on Open VSX and leaves the VS Code Marketplace for later, so VS Code users still download the .vsix from GitHub Releases. The Marketplace is part of Azure DevOps, and publishing to it takes an Azure DevOps credential. Which credential can a release job use, and how does it stay out of reach of everything else the release runs?

Three things decide it:

- Azure DevOps retires global personal access tokens (PATs) on 1 December 2026, and the Marketplace only takes a PAT scoped to all organizations, which is a global one.
- `vsce` 4 has `vsce publish --oidc`, the same trusted publishing as Open VSX's, but in October 2026 the Marketplace doesn't support it yet: the exchange fails with `TrustedPublishingNotSupportedException`, and there's nowhere to register a trusted publisher (issue 1275 in `microsoft/vscode-vsce`).
- Listing is hard to undo, as on Open VSX: the Marketplace never accepts a version number twice, and removing an extension reserves its name forever.

## Considered Options

- A Marketplace PAT in an environment secret
- Trusted publishing with `vsce publish --oidc`
- A Microsoft Entra ID app registration with a federated credential
- An Azure user-assigned managed identity with a federated credential, and `vsce publish --azure-credential`

## Decision Outcome

Chosen option: the managed identity, because it's the only one that works both now and after 1 December 2026, and it stores no long-lived credential in GitHub. `azure/login` exchanges the job's GitHub OIDC token for an Azure login, and `vsce` takes its token from that. An app registration needs no Azure subscription, but others report that it signs in and then fails at publish with `InvalidAccessException`.

<!-- vale RedHat.Slash = NO -->

- A `vs-marketplace` job in `release.yml`, beside `open-vsx` and built the same way: it runs after the `publish` job, runs `gh attestation verify` on the `vsix` artifact before installing anything, and installs `vsce` alone from `tools/vsce/` with `npm ci --ignore-scripts`. The same attested .vsix goes to every registry, as ADR 0041 says.
- The job holds `contents: read`, `attestations: read` and `id-token: write`, and runs in the `vs-marketplace` environment, which only `main` can deploy to.
- `azure/login` runs after `vsce` is installed, so the Azure login exists only for the steps that need it.
- The two registry jobs don't depend on each other: a failure in one leaves the other's listing in place, and re-running the failed jobs recovers. `vsce publish --skip-duplicate` makes a re-run after a success do nothing.
- Versions below 1.0 are listed as ordinary releases, as on Open VSX.

<!-- vale RedHat.Slash = YES -->

### Setting up the identity

The maintainer does this once, outside the repository:

1. Create the publisher `edziegle` at <https://marketplace.visualstudio.com/manage>.
2. In an Azure subscription (a free one is enough; the identity gets no role in it), create a user-assigned managed identity. Give it a federated credential for the GitHub Actions scenario with organization `edziegle`, repository `dear_reviewer`, entity type Environment and environment `vs-marketplace`.
3. In the repository, create the `vs-marketplace` environment with `main` as its only deployment branch, and set the environment variables `AZURE_CLIENT_ID` and `AZURE_TENANT_ID` to the identity's client and tenant IDs. These identify the identity but grant nothing, so they're variables, not secrets.
4. On the first release, the job prints the identity's Marketplace member ID with `mise run marketplace-member-id`, then fails to publish, since the identity isn't a member of the publisher yet. Add that ID to the `edziegle` publisher as a Contributor and re-run the failed jobs.

A federated credential for an environment matches every run that deploys to it, whatever the branch or tag, so the environment's branch rule is what keeps other branches from listing a release, as with the Open VSX trusted publisher.

When the Marketplace supports trusted publishing, the job switches to `vsce publish --oidc` and drops `azure/login`, and the maintainer deletes the managed identity.

### Consequences

- Good, because VS Code users install and update the extension from their own extensions view.
- Good, because no long-lived credential is stored in GitHub, and the identity can only sign in from the `vs-marketplace` environment.
- Bad, because an Azure subscription and a managed identity exist, outside GitHub, only for this step.
- Bad, because `azure/login` is one more third-party action in a job that can publish. It's pinned to a commit, as every action here is.
- Bad, because the first release fails in this job until the maintainer adds the identity to the publisher.
- Bad, because the Marketplace doesn't check the attestation either, so a user who installs from it trusts the Marketplace's own check of the publisher.
