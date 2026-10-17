# Integration test audit: needs the host, or pure logic

Audit for issue #88 (part of #85). It marks every integration test file in `extension/test/suite/` as **needs-host** or **pure-logic**, and records what moved to `extension/test/unit/`.

## How a file was marked

A test **needs the host** when it checks behaviour that only exists in the extension host:

- a view (tree, status bar item, webview), the comments API, a tab or editor, or the command palette
- a workspace folder change, a reload, or the review window
- the wiring from a click or a command to its effect

A test is **pure logic** when its subject runs under plain Node: it takes plain values or a git repository and gives plain values, and the module under test doesn't import `vscode`.

Most files are marked by their subject, not test by test. The last column of the tables says what each file still needs the host for. The files with a **mixed** mark have a few pure-logic tests among host ones; the section after the tables says what became of them.

## Result

- Tests moved down: 8 integration tests deleted, each with a unit test that covers the same behaviour (the first table below). The unit side also gained tests for the logic the integration tests only reached through a window launch.
- Files removed: `inbox/settings.test.ts`.
- Modules extracted so unit tests can import them without `vscode`: `src/remotes.ts` (`remoteFor`, from `changeWorkspace.ts`) and `src/repositoryNames.ts` (`isRepositoryName`, `gitHubHost`, `gitHubRepository`, `namesRepository`, from `repositories.ts`).
- Integration tests: 310 `it` blocks in 52 files before, 302 after (the 619 in the issue is the count mocha reports for a full run; this audit counts the `it` blocks in the source). The 8 tests ran about 0.27 s each, so a run saves about 2 s. No suite or phase became empty, so the launch count is unchanged. The launch count is where the time is (about 19 s a launch, 26 launches; #86 groups launches), so moving more tests down will not make a run noticeably faster. The value of this work is that the logic is tested in milliseconds, with the host test kept for the wiring.

### What moved

| Integration test deleted                                                                                     | Unit test that covers it                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inbox/settings`: talks to github.com unless the Reviewer sets another API base URL                          | `unit/settings.test.ts`, which reads the defaults from `package.json`                                                                                                                                                                                       |
| `assistant/summary`: gives claude only the variables it needs to find itself, its login and the network      | `unit/claude.test.ts` (`claudeEnvironment`). The credential-variables test stays as the one wiring test                                                                                                                                                     |
| `localReview/comments`: keeps a Comment from ending its fence in the prompt                                  | `unit/prompts.test.ts` ("keeps a Comment's backticks from ending its thread's fence")                                                                                                                                                                       |
| `inbox/authoredByMe`: keeps changes requested after the reviewer replies in a thread                         | `unit/authoredStates.test.ts` ("keeps changes requested after the same reviewer replies in a thread", "stays ready to merge after an approver replies in a thread", "has changes requested when GitHub's review decision says so")                          |
| `inbox/authoredByMe`: leaves out a dismissed approval, but not a later one                                   | `unit/authoredStates.test.ts` ("isn't ready to merge while a review is required, or after a dismissal alone"). The "but not a later one" half is GitHub's choice of each reviewer's latest review, which the fake GitHub copies, so no test of ours owns it |
| `inbox/authoredByMe`: isn't ready to merge as a draft, with checks running, or while mergeability is unknown | `unit/authoredStates.test.ts` ("isn't ready to merge as a draft, with checks running, or with mergeability unknown")                                                                                                                                        |
| `localBranches`: finds main without a remote, from the local main branch                                     | `unit/localBranches.test.ts` ("find main from the remote's default branch", "find master when there is no main" and the local-main case)                                                                                                                    |
| `dashboard/ignored`: brings it back to Waiting on you with the wait it had                                   | `unit/dashboard.test.ts` ("keep their own wait, so restoring one gives back the wait it had") and `unit/ignoredPullRequests.test.ts`                                                                                                                        |

Unit tests added without deleting an integration test, because the integration test also checks wiring that only the host has:

- `unit/localBranches.test.ts`: `branchesAhead`, `branchIsOver` and `remoteFor` against real git repositories (commits made with `git commit-tree`, so no signing key is needed). `lifecycle/localBranches` stays: it checks that the Change, its conversation and its Comments end.
- `unit/repositoryNames.test.ts`: the repository name, host and remote URL rules. `openFolders/openFolders` ("leaves out remotes on another host") stays: the folder it opens is also what the next test closes and expects to be remembered, so the two share state in the window.
- `unit/claude.test.ts` also covers `describeLogin`. The three status bar tests in `assistant/summary` stay.

## Per-file audit

Counts are `it` blocks. The mark is **host** unless it says **mixed**.

### assistant

| File                                                                   | Tests | Mark            | Needs the host for                                                                                                                                                   |
| ---------------------------------------------------------------------- | ----- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assistant/chat.test.ts`                                               | 12    | host            | the chat panel, the Ask command and key binding, the editor selection, conversation per Change                                                                       |
| `assistant/summary.test.ts`                                            | 9     | mixed (1 moved) | overview webview, status bar login item, claude spawned by the extension. The env and argument checks are covered in `unit/claude.test.ts`; one run keeps the wiring |
| `assistant/replies.test.ts`                                            | 3     | host            | webview rendering and link handling in the panel                                                                                                                     |
| `assistant/history.test.ts`                                            | 2     | host            | the git server started for a real claude process (the tool logic is in `unit/gitTools.test.ts` and `unit/gitServer.test.ts`)                                         |
| `assistant/setup.test.ts`                                              | 5     | host            | settings scope, the Retry command, the sign-in prompt                                                                                                                |
| `assistant/thenReload.test.ts`, `assistant/afterReload/resume.test.ts` | 1, 3  | host            | a window reload                                                                                                                                                      |

### changeFiles, codeFlow, findings, threads, timeline

| File                                          | Tests | Mark | Needs the host for                                                                                                                                             |
| --------------------------------------------- | ----- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `changeFiles/changeFiles.test.ts`             | 20    | host | the Change Files tree, tabs, title bar menus, context keys. The tree and viewed-progress logic is in `unit/fileTree.test.ts` and `unit/viewedProgress.test.ts` |
| `changeFiles/afterReload/viewedState.test.ts` | 4     | host | reload                                                                                                                                                         |
| `codeFlow/codeFlow.test.ts`                   | 10    | host | the webview and a language server (the graph logic is in `unit/codeFlow*.test.ts`)                                                                             |
| `findings/findings.test.ts`                   | 17    | host | gutter decorations, hover, comments API, review keys (the gutter logic is in `unit/findingGutter.test.ts`)                                                     |
| `threads/threads.test.ts`                     | 10    | host | the comments API and GitHub round trips                                                                                                                        |
| `threads/failedLoads.test.ts`                 | 4     | host | notifications, window focus, the Retry command                                                                                                                 |
| `timeline/timeline.test.ts`                   | 20    | host | the overview webview, title bar commands, palette entries, tabs                                                                                                |
| `timeline/highlighting.test.ts`               | 4     | host | the Extensions view and installed languages                                                                                                                    |

### dashboard, inbox, localBranches, openFolders

| File                                                                             | Tests | Mark            | Needs the host for                                                                                                                                                    |
| -------------------------------------------------------------------------------- | ----- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dashboard/dashboard.test.ts`                                                    | 10    | host            | the Dashboard webview, view containers, the palette (ordering and facts are in `unit/dashboard.test.ts`)                                                              |
| `dashboard/dashboardTeamRequests.test.ts`                                        | 2     | host            | the Dashboard webview                                                                                                                                                 |
| `dashboard/ignored.test.ts`                                                      | 3     | mixed (1 moved) | webview messages and the Inbox refresh; the set-aside rules are in `unit/dashboard.test.ts` and `unit/ignoredPullRequests.test.ts`                                    |
| `dashboard/ignoredAcrossReload.test.ts`, `dashboard/afterReload/ignored.test.ts` | 1, 1  | host            | reload                                                                                                                                                                |
| `inbox/inbox.test.ts`                                                            | 11    | host            | the Inbox tree, sign-in state, welcome views. The request and error rules are in `unit/request.test.ts`                                                               |
| `inbox/authoredByMe.test.ts`                                                     | 7     | mixed (3 moved) | the tree item's icon and description, and the reload loop when mergeability is unknown. The state rules are in `unit/authoredStates.test.ts`                          |
| `inbox/teamRequests.test.ts`                                                     | 9     | host            | the tree, with GitHub's responses scripted. The team rules are in `unit/teamReviews.test.ts`; the paging and the missing `read:org` case go through the GitHub client |
| `inbox/security.test.ts`                                                         | 4     | host            | the settings scopes (workspace settings must not win), `SecretStorage`, the avatar cache                                                                              |
| `inbox/settings.test.ts`                                                         | 1     | removed         | now `unit/settings.test.ts`                                                                                                                                           |
| `localBranches/localBranches.test.ts`                                            | 5     | mixed (1 moved) | the Local branches group, opening a branch as a Change, `~` expansion in the setting                                                                                  |
| `openFolders/openFolders.test.ts`                                                | 6     | host            | workspace folder changes. The name rules are now in `unit/repositoryNames.test.ts`                                                                                    |
| `openFolders/elsewhere/elsewhere.test.ts`                                        | 6     | host            | the folder picker and remembered clones across windows                                                                                                                |

### lifecycle, multiRoot, singleFolder, pullRequest

| File                                                                      | Tests | Mark | Needs the host for                                                                                          |
| ------------------------------------------------------------------------- | ----- | ---- | ----------------------------------------------------------------------------------------------------------- |
| `lifecycle/deletedWorktrees.test.ts`                                      | 7     | host | workspace folders, the Inbox refresh, leaving a window                                                      |
| `lifecycle/localBranches.test.ts`                                         | 3     | host | ending a Change, with its conversation and Comments. The branch rule is now in `unit/localBranches.test.ts` |
| `lifecycle/pullRequests.test.ts`                                          | 3     | host | worktrees and folders removed when the Inbox refreshes                                                      |
| `lifecycle/thenReload.test.ts`, `lifecycle/afterReload/startup.test.ts`   | 1, 2  | host | reload and startup                                                                                          |
| `multiRoot/*.test.ts` (6 files)                                           | 16    | host | workspace folders, language features per folder, Workspace Trust, several Changes in one window             |
| `singleFolder/openChange.test.ts`, `singleFolder/mergedElsewhere.test.ts` | 6, 1  | host | two windows: the review window beside this one                                                              |
| `pullRequest/openPullRequest.test.ts`                                     | 9     | host | worktrees made from a fetch, viewed state through the files view                                            |
| `pullRequest/autoRefresh.test.ts`                                         | 5     | host | window focus (the gate rules are in `unit/refreshGate.test.ts`; #87 owns this file)                         |

### review, localReview, readingOrder, sinceLastReview, screenshots

| File                                                                            | Tests | Mark            | Needs the host for                                                                 |
| ------------------------------------------------------------------------------- | ----- | --------------- | ---------------------------------------------------------------------------------- |
| `review/comments.test.ts`                                                       | 13    | host            | the comments API, with GitHub round trips                                          |
| `review/afterReload/pendingReview.test.ts`                                      | 7     | host            | reload, the pending review, submitting                                             |
| `localReview/comments.test.ts`                                                  | 10    | mixed (1 moved) | the comments API for local Comments; the prompt fence is in `unit/prompts.test.ts` |
| `localReview/afterReload/brief.test.ts`                                         | 14    | host            | reload, the Brief document, the clipboard                                          |
| `readingOrder/readingOrder.test.ts`, `readingOrder/afterReload/restore.test.ts` | 5, 1  | host            | the overview, Change Files, reload                                                 |
| `sinceLastReview/sinceLastReview.test.ts`                                       | 12    | host            | the Inbox row, the overview, a multi-file diff                                     |
| `screenshots/screenshots.test.ts`                                               | 6     | host (opt-in)   | a themed window; not part of a normal run                                          |

## Candidates left for later

Each of these tests reaches pure logic through a window. It is still marked **host** because the logic sits in a module that imports `vscode`, or in the GitHub client behind the fake server, and no unit test covers the whole behaviour yet.

- `inbox/teamRequests`: paging past 100 team members, the missing `read:org` case, and reading review history only when the Reviewer is on a team. The code is in `github/client.ts`, which doesn't import `vscode`. A unit test could serve `test/fakeGitHub.ts` from Node and call the client, then these tests would shrink to one wiring test.
- `inbox/authoredByMe`: the reload loop for unknown mergeability lives in `inbox.ts`; its rule could move to a pure function.
- `sinceLastReview`: which commits a Review covered and the standing line are mostly in `reviewStanding.ts`; the Inbox mark is in `inbox.ts`.
- `inbox/security`: the "send no token to plain-http or another origin" rule is in `github/client.ts` and `github/auth.ts`. The settings-scope check is host-only, the rest could be a client unit test.
