---
status: accepted
date: 2026-10-17
---

# Group the integration suites into fewer launches

## Context and Problem Statement

A **launch** is one VSCodium start for a phase, and a **run** is one `mise run test-integration`, which holds the lock (ADR 0028). Each suite had a launch of its own, and each suite with a window reload had two: 26 launches. Starting VSCodium and its extension host cost about 19 s a launch, 74% of a 653 s run, while the 619 tests took 168 s in all. Issue #85 sets the targets: a full local run under 5 minutes, and CI integration under 4. How few launches can a run make without suites breaking each other?

Three things keep suites apart today, and a shared launch gives them up:

- A launch has a window of its own, so a suite starts with no Change open, with no folders of another suite in the workspace and with the settings it expects.
- Each suite's window is the shape it needs: a single folder, a multi-root workspace, or a workspace to reload.
- A suite that crashes the extension host takes down only itself.

## Considered Options

- One launch for each suite, as before
- One launch for all suites
- Group the suites that need no reload, keep the differently shaped windows apart, and chain the reload suites

## Decision Outcome

Chosen option: "Group the suites that need no reload, keep the differently shaped windows apart, and chain the reload suites", because it removes most launches and keeps each suite's window the shape it asks for.

- **Phases and launches.** A launch runs a list of phases one after another. Each phase is a Mocha run of its suite's folder, with fixtures in a folder of its own, so a suite builds its repositories as before. A phase that fails doesn't stop the ones after it. `extension/test/run.ts` lists the launches.
- **The multi-root suites share a launch.** `multiRoot`, `pullRequest`, `timeline`, `threads`, `localBranches`, `sinceLastReview`, `findings` and `codeFlow` need a multi-root window and no reload. They run in the last launch of the reload chain, after `lifecycle`'s `afterReload` phase, whose window is clean by then.
- **Differently shaped windows keep their own launches.** `singleFolder` and `inbox` run first, before suites that leave pull request Changes in the user data, which a later window polls and so shows to the Inbox's tests. `openFolders` and `openFolders/elsewhere` run last, so the repositories they remember can't reach other suites.
- **The reload suites form a chain, not one shared reload.** The plan was one launch for all first phases and one for all `afterReload` phases. It can't work: showing a Change closes the other Changes' tabs (ADR 0020), so a reload restores the tabs of the Change in front and no others, and `changeFiles`, `assistant`, `review`, `localReview` and `readingOrder` read those tabs back after the reload. Instead, each launch runs the `afterReload` phase of one suite and then the first phase of the next, which leaves its Change in front for the launch after. `dashboard` keeps its state in settings and the Inbox, not in tabs, so it rides along with `changeFiles`. The order has two constraints. `localReview` goes first, because its Comments show the Reviewer's name only once a suite has signed in, and the extension keeps what it learned until the window closes. `lifecycle` goes last of the first phases, because it deletes Dear Reviewer's storage. The six suites that run in the chain take seven launches, instead of twelve; `dashboard` adds none.
- **Failures are reported by suite.** A launch writes its progress after each phase. When the extension host crashes or hangs partway, the phase that was running is listed as having crashed it, the phases after it as not run, and all count as failures. Nothing reruns: that would be a retry.
- **Narrowing still works.** `DEAR_REVIEWER_SUITES`, `DEAR_REVIEWER_FILES` and `DEAR_REVIEWER_GREP` pick the phases, and a launch with none of them makes no start.

### Consequences

- Good, because a full run makes 11 launches instead of 26 and takes about 4 minutes locally instead of 11, and the pure helper that plans them has unit tests.
- Good, because the failures read by suite, and a crash can't hide the suites after it.
- Bad, because suites in one launch share a window and its settings. A suite must leave no Change open, setting changed or folder added that the next suite can see, except for the one that a reload suite leaves on purpose. A suite that breaks this fails the suites after it.
- Bad, because a crash of the extension host fails every suite after it in its launch. The failure list says which suite crashed and which didn't run, and a rerun of the launch's suites tells them apart.
- Bad, because the reload suites can't all share two launches, so the run still makes more launches than the seven that grouping alone would give. `changeFiles`, `assistant`, `review`, `localReview` and `readingOrder` each need a launch for their `afterReload` phase. What is left to shorten the run is to shard the CI job by suite (issue #85).
