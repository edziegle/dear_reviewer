# PyCharm GitHub pull request review, and how JetBrains AI plugs into it

Researched on 2026-10-12. Every claim cites a primary JetBrains source: official docs, JetBrains blog or release notes, YouTrack, the JetBrains Marketplace API, or JetBrains source code. The single exception is labelled.

**Source code.** All code references point at `JetBrains/intellij-community` commit [`5f40c823bf`](https://github.com/JetBrains/intellij-community/tree/5f40c823bf599a425aecb253d990fa94494e5d46) (master, committed 2026-10-13 UTC). Two path abbreviations are used:

- `GH/` means `plugins/github/github-core/`
- `CT/` means `platform/collaboration-tools/`

To turn a reference into a link, prepend `https://github.com/JetBrains/intellij-community/blob/5f40c823bf599a425aecb253d990fa94494e5d46/` to the expanded path, then add `#L<n>`.

**How the docs were read.** Some pages were read through a summarising fetcher, and some jetbrains.com "What's New" pages render client-side. Claims sourced only from a search-result summary of a JetBrains page are marked **[search summary]**; treat them as weaker than a direct read.

## Summary

- **Integration.** PyCharm's GitHub support is the bundled **GitHub plugin** (`org.jetbrains.plugins.github`). It ships in lockstep with the IDE; Marketplace builds `263.x` correspond to 2026.3. It depends on Git4Idea and on the shared **collaboration-tools** platform module, which the GitLab plugin also uses.
- **Pull Requests tool window.** You can:
  - list, filter and sort PRs;
  - open a PR as an editor tab with Overview, Timeline and Diff;
  - check out the PR branch, or (new in 2026.3) open it in a Git worktree;
  - review in the diff or in the editor ("Review Mode") with gutter comments;
  - post single comments or build a pending review ("Start Review");
  - apply suggested changes locally;
  - resolve threads;
  - submit Approve, Request Changes or Comment;
  - merge, squash-merge or rebase-merge;
  - create PRs, including drafts and repository templates;
  - see CI check status.
- **Transport.** Almost everything goes over **GitHub GraphQL v4**: 40 bundled `.graphql` queries and mutations. **REST v3** is used for:
  - merging;
  - reviewer add/remove;
  - title/body/state edits;
  - labels and assignees;
  - top-level issue comments;
  - diffs, file lists and compare (merge base);
  - emojis.

  The PR branch itself is fetched with local `git fetch`.

- **Authentication.**
  - github.com: browser OAuth through a JetBrains relay (`account.jetbrains.com/github/oauth/intellij`, PKCE), or a token.
  - Any other server, including GitHub Enterprise: **token only** in the current code.
  - Required classic scopes: `repo, gist, read:org, workflow, read:user, user:email`.
  - Minimum GitHub Enterprise Server version: 3.2.
- **AI hooks in the open-source plugin.** There are three `@ApiStatus.Internal` extension points: PR title/description generation, AI PR review, and AI PR summary. JetBrains AI Assistant (closed source) implements them. **Third-party plugins should not rely on them**: they are internal, and the review and summary ones are single-implementation.
- **AI Assistant user-facing features:**
  - "Generate a Title and Description with AI Assistant" in Create Pull Request (since 2024.3).
  - "GitHub Plugin: Generate a summary upon opening a Pull Request" (a setting).
  - "Self-Review with AI" on local or committed changes; results go to a Problems tab.
  - Commit message generation and improvement.
  - "Explain Commit with AI Assistant".
  - "Merge with AI".
- **AI review inside the PR diff.** The plugin has AI review comment plumbing: AI comments in the diff that you accept or reject, plus a chat thread per comment. When it was added (October 2024) the commit history says it was made **internal-only**. Whether it is now user-visible could not be verified.
- **Junie is the JetBrains AI reviewer that runs on GitHub itself.** It is a GitHub Action (`JetBrains/junie-github-action`) that reviews PRs with inline comments, triggered automatically or by `@junie-agent code-review`. It is not part of the IDE plugin. There is also a Junie CLI `/review` command for local review.
- **Biggest open gaps in YouTrack:**
  - OAuth for GitHub Enterprise;
  - fine-grained or multiple PATs;
  - GitHub Apps authentication;
  - multi-repo PR list;
  - "changes since last review";
  - selecting several commits for the diff;
  - multi-line comment glitches;
  - auto-merge;
  - timeline filtering;
  - custom prompts for AI PR title and description.

---

## 1. The plugin and where it lives

- **Identity and setup.** The plugin is named "GitHub", has the id `org.jetbrains.plugins.github` and vendor JetBrains, and requires Git4Idea. Users configure it under **Settings | Version Control | GitHub**. Sources: `GH/resources/META-INF/plugin.xml` L1-16, L31; Marketplace API `https://plugins.jetbrains.com/api/plugins/13115` (description text identical).
- **Release cadence.** Marketplace releases track IDE builds: the latest are `263.6800.24`, `263.6259.36` and `263.5701.42`, each pinned to a single build line. In other words the plugin is updated with the IDE, not separately. Source: `https://plugins.jetbrains.com/api/plugins/13115/updates`.
- **Modules.** The plugin is modular:
  - Open source: `intellij.vcs.github` (core), `.git`, `.tracker`, `.json`, `.ultimatePromo`.
  - Not present in the community repo: `intellij.vcs.github.ultimate.features`, `.ultimate.docker`, `.ultimate.cron`. They are presumably closed source (unverified).
  - Source: `GH/resources/META-INF/plugin.xml` L18-27.
- **Collaboration-tools dependency.** The core module depends on `intellij.platform.collaborationTools`, plus its `.auth` and `.auth.base` modules. Source: same file, L49-51.

## 2. Connecting GitHub accounts

### What the docs say

- **Settings path.** Settings (Ctrl+Alt+S) | Version Control | GitHub, then **Add**. Source: [PyCharm: Set up a GitHub account](https://www.jetbrains.com/help/pycharm/set-up-a-github-account.html).
- **"Log In via GitHub"** uses OAuth 2.0 in the browser and supports 2FA. Source: same page, section "Add an existing account by signing in to GitHub".
- **"Log In with Token"** lets you paste a token or click **Generate…**.
  - Required scopes: `repo`, `gist`, `read:org`, `workflow`, `read:user`, `user:email`.
  - Fine-grained PATs "are currently not fully supported out of the box, but the IDE does not restrict their use."
  - Source: same page, section "Add an existing account with a token".
- **"Log In to GitHub Enterprise"** asks for a server URL. Examples given include `example.ghe.com` and self-hosted servers. Source: same page, section "Log in to a GitHub Enterprise account".
  - The fetched summary also said GHE supports OAuth. **That contradicts the code and an open issue (see below), so treat it as wrong or unverified.**
- **Multiple accounts and default account.** You can add several accounts. One is marked **Set as Default** and is used for sharing projects, rebasing forks and creating PRs. Source: same page, section "Manage multiple GitHub accounts".

### What the code does

- **Scopes.** The scope list is hard-coded as `MASTER_SCOPES = repo, gist, read:org, workflow, read:user, user:email`. The **Generate…** link opens `<server>/settings/tokens/new?description=<IDE> GitHub integration plugin&scopes=…`, which is the classic PAT form. Source: `GH/src/org/jetbrains/plugins/github/authentication/util/GHSecurityUtil.kt` L10-35.
  - YouTrack [IJPL-246282](https://youtrack.jetbrains.com/issue/IJPL-246282) (open) complains that this link goes to classic PAT creation.
- **OAuth flow.**
  - The IDE's built-in web server on `127.0.0.1:<port>` receives the callback.
  - The request uses PKCE (`code_challenge`).
  - The authorisation goes through JetBrains' relay at `https://account.jetbrains.com/github/oauth/intellij/authorize`.
  - The token comes back from `…/access_token` in an `X-OAuth-Token` header.
  - Sources: `GH/src/org/jetbrains/plugins/github/authentication/GHOAuthService.kt` L30-59; `GHOAuthCredentialsAcquier.kt` L13-26; callback handler `GHOAuthCallbackHandler.kt`.
- **OAuth is github.com only.** `if (request.server != GithubServerPath.DEFAULT_SERVER) request.loginWithToken(...)`, where `DEFAULT_SERVER` is `github.com`. Every other host, including `*.ghe.com`, is token-only. Sources: `GH/src/org/jetbrains/plugins/github/authentication/GHAccountsUtil.kt` L210-219; `GH/src/org/jetbrains/plugins/github/api/GithubServerPath.java` L26-28.
  - The open feature request is [IJPL-182218](https://youtrack.jetbrains.com/issue/IJPL-182218), "Support authentication via browser (OAuth) for GitHub Enterprise server".
- **API URLs.**
  - github.com: REST at `https://api.github.com`, GraphQL at `https://api.github.com/graphql`.
  - GHE: REST at `https://<host>[/<suffix>]/api/v3`, GraphQL at `https://<host>[/<suffix>]/api/graphql`.
  - Source: `GithubServerPath.java` L29-32, L126-146.
- **Minimum GHE version is 3.2.** It is read from the `x-github-enterprise-version` header. Source: `GH/src/org/jetbrains/plugins/github/api/GHEServerVersionChecker.kt` L6-9, L23-31.
- **UI labels.** The action labels are "Log In via GitHub…" and "Log In to GitHub Enterprise…". Source: `GH/resources/messages/GithubBundle.properties` L14-15.
- **Credential storage.** Accounts persist in the application-level `GHPersistentAccounts`. Source: `GH/resources/intellij.vcs.github.xml` L95. That tokens go to the IDE password safe is inferred from the `credentialStore` dependency (`plugin.xml` L56-57) and is unverified in detail.

### Open authentication issues (all open as of 2026-10-12)

- [IJPL-179595](https://youtrack.jetbrains.com/issue/IJPL-179595): fine-grained PATs. You cannot hold several PATs for one account.
- [IJPL-238890](https://youtrack.jetbrains.com/issue/IJPL-238890): support GitHub Apps instead of the OAuth App.
- [IJPL-72809](https://youtrack.jetbrains.com/issue/IJPL-72809): multiple accounts with SSH aliases (56 votes).
- [IJPL-185994](https://youtrack.jetbrains.com/issue/IJPL-185994): GHE with SAML enforcement is unclear.
- [IJPL-79822](https://youtrack.jetbrains.com/issue/IJPL-79822): reuse the `gh` CLI token.

## 3. The Pull Requests tool window, feature by feature

Primary doc: [PyCharm: Work with GitHub pull requests](https://www.jetbrains.com/help/pycharm/work-with-github-pull-requests.html). The IntelliJ IDEA copy is [here](https://www.jetbrains.com/help/idea/work-with-github-pull-requests.html).

| Capability                           | Docs                                                                                                                                                                   | Code evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Open the tool window**             | Git \| GitHub \| View Pull Requests. A white dot marks the tool window when there are unseen PRs; unseen PRs get blue dots.                                            | Tool window id `Pull Requests`, factory `GHPRToolWindowFactory` (`GH/resources/intellij.vcs.github.xml` L133-135). `GitHub.MainMenu` group holds Create and View Pull Requests and sits under the Git menu (L249-259).                                                                                                                                                                                                                                                                                                                                                                                                    |
| **List, filter and sort**            | Filter by state, author, label, assignee and review status. Sort by newest, oldest, most or least commented, recently or least recently updated. Refresh with Ctrl+F5. | Filter labels: State, Assignee, Review, Author, Label, Sort. Quick filters: "Open", "Your pull requests", "Assigned to you", "Review requests". Review filter values include "Approved review", "Reviewed by you" and "Not reviewed by you" (`GithubBundle.properties` L179-205). The list is a GraphQL `search` query (`GH/src/org/jetbrains/plugins/github/pullrequest/data/GHPRDataContext.kt` L46-49; `GH/resources/graphql/query/issueSearch.graphql`).                                                                                                                                                              |
| **PR details and timeline**          | Double-clicking a PR opens Overview and Timeline. You can select a commit to filter the changes. The Timeline shows progression and high-level comments.               | Timeline uses GraphQL `pullRequestTimeline.graphql`. PR editor tabs live on a virtual file system with the `ghpr` key (`intellij.vcs.github.xml` L128-131).                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Check out the branch**             | Context menu "Checkout '\<branch\>'" starts Review mode.                                                                                                               | Actions `Github.PullRequest.CheckoutBranch` ("Checkout Branch") and, new, `Github.PullRequest.OpenInWorktree` ("Open in Worktree": "Fetch and open the pull request branch in a Git worktree"). Sources: `intellij.vcs.github.xml` L275-278; `GithubBundle.properties` L217-220. Worktree support shipped in **2026.3 EAP 1** ([IJPL-242111](https://youtrack.jetbrains.com/issue/IJPL-242111), "Available in: 2026.3 EAP 1"; commit `9df299674a`, 2026-07-22).                                                                                                                                                           |
| **Diff and Review Mode**             | Diff with Ctrl+D. In-editor review with F4 after checkout. Review Mode toggle in the editor's top-right corner. Pink gutter markers.                                   | Platform strings: "Review Mode", "In Review Mode, you can see review comments and proposed changes right in the editor", "Show Unresolved Comments Only", "Update Branch to Enable Review Mode…" (`CT/shared/resources/messages/CollaborationToolsBundle.properties` L159-165). Per-project settings `editorReviewEnabled=true` and `editorReviewViewOption=UNRESOLVED_ONLY` (`GH/src/org/jetbrains/plugins/github/pullrequest/config/GithubPullRequestsProjectUISettings.kt` L32-36). Editor wiring is `GHPRReviewInEditorController` (`intellij.vcs.github.xml` L117); diff wiring is `GHPRReviewDiffExtension` (L114). |
| **Gutter comments**                  | Hover the gutter and click the add icon.                                                                                                                               | Gutter models in `CT/shared/src/com/intellij/collaboration/ui/codereview/editor/CodeReviewEditorGutter*.kt`. Platform actions `Code.Review.Editor.New.Comment`, `CodeReview.NextComment` and `CodeReview.PreviousComment` (`CT/shared/resources/intellij.platform.collaborationTools.shared.xml` L45-65).                                                                                                                                                                                                                                                                                                                 |
| **Single comment vs pending review** | "Add Single Comment" posts immediately. "Start Review" collects pending comments that you can edit before submitting.                                                  | Strings `pull.request.review.editor.start.review` and `…add.single.comment` (`GithubBundle.properties` L269-271). GraphQL: `createReview`, `findPendingReview`, `addReviewComment`, `addPullRequestReviewThread`, `updateReview`, `deleteReview` (`GH/src/org/jetbrains/plugins/github/api/GHGQLQueries.kt` L30-38).                                                                                                                                                                                                                                                                                                      |
| **Suggested changes**                | Write a ` ```suggestion ` Markdown block.                                                                                                                              | Parser `SUGGESTION_BLOCK_START = "```suggestion"` (`GH/src/org/jetbrains/plugins/github/pullrequest/comment/GHSuggestedChange.kt` L34). Received suggestions get "Apply Locally" and "Commit…" buttons. Outdated or resolved suggestions, and those from another branch, cannot be applied. Applying can also resolve the thread. Sources: `GithubBundle.properties` L318-328; `GHSuggestedChangeApplier.kt` L27-44. Applying suggestions locally arrived in **2022.1** ([2022.1 release post](https://blog.jetbrains.com/idea/2022/04/intellij-idea-2022-1/) [search summary]).                                          |
| **Resolve and unresolve threads**    | Not in the PR doc page.                                                                                                                                                | Platform strings "Resolve" and "Unresolve" (`CollaborationToolsBundle.properties` L184-185). GraphQL `resolveReviewThread` and `unresolveReviewThread` (`GHGQLRequests.kt` L704-725). Details pane shows a count of unresolved comments (`GithubBundle.properties` L265).                                                                                                                                                                                                                                                                                                                                                 |
| **Mark files viewed**                | —                                                                                                                                                                      | GraphQL `markFileAsViewed` and `unmarkFileAsViewed`. Action "Toggle viewed/not viewed state". Setting "Automatically mark opened files as viewed" (`GithubBundle.properties` L9, L131). In **2025.3** "mark as reviewed" became manual ([What's fixed in 2025.3](https://blog.jetbrains.com/idea/2025/12/what-s-fixed-in-intellij-idea-2025-3/) [search summary]).                                                                                                                                                                                                                                                        |
| **Submit review**                    | **Submit** offers Approve, Request changes or Comment.                                                                                                                 | Action `Github.PullRequest.Review.Submit`. Strings "Approve", "Request Changes", "Comment" ("Submit general feedback without explicit approval") (`GithubBundle.properties` L273-280). GraphQL `submitReview` with a `GHPullRequestReviewEvent` (`GHGQLRequests.kt` L571).                                                                                                                                                                                                                                                                                                                                                |
| **Reviewers**                        | **More** menu: "Request Review".                                                                                                                                       | Actions `GHPRRequestReviewAction`, `GHPRReRequestReviewAction`, `GHPRSetMyselfAsReviewerAction`, `GHPRRemoveReviewerAction` (`GH/src/org/jetbrains/plugins/github/pullrequest/ui/details/action/`). These use REST `POST`/`DELETE /repos/{o}/{r}/pulls/{n}/requested_reviewers` (`GithubApiRequests.kt` L655-675).                                                                                                                                                                                                                                                                                                        |
| **Merging**                          | **Merge**, plus a dropdown with "Squash and Merge" and "Rebase". **More** has "Close Pull Request".                                                                    | REST `PUT /repos/{o}/{r}/pulls/{n}/merge` with merge, squash and rebase variants, guarded by `sha` = current head (`GithubApiRequests.kt` L616-644; `GH/src/org/jetbrains/plugins/github/pullrequest/data/service/GHPRDetailsServiceImpl.kt` L155-185). Mergeability comes from the GraphQL fragment `pullRequestMergeability` (`mergeable`, `canBeRebased`, `mergeStateStatus`, base-ref `refUpdateRule`). The "Delete merged branch" timeline action uses GraphQL `deleteRef`. There is also an in-IDE conflict resolution path ("Resolve", `CollaborationToolsBundle.properties` L119-137).                            |
| **Creating PRs**                     | Not covered by the PR doc page.                                                                                                                                        | Action `Github.Create.Pull.Request`. Buttons "Create Pull Request" and "Create Draft Pull Request" (`GithubBundle.properties` L148-149). Repository PR templates load via GraphQL `getPullRequestTemplates`. Creation uses GraphQL `createPullRequest`. Existing PRs for a head branch are looked up first (`GHPRCreationServiceImpl.kt` L68-82). The 2024.1 push notification offers to create a PR ([2024.1 release post](https://blog.jetbrains.com/idea/2024/04/intellij-idea-2024-1/)).                                                                                                                              |
| **CI status**                        | Not in the PR doc page.                                                                                                                                                | GraphQL fetches the last commit's legacy `status.contexts` and `checkSuites(first:100){checkRuns(first:100)}` (`GH/resources/graphql/fragment/commitWithCheckStatuses.graphql`, `checkSuite.graphql`). Details pane shows "Checks failed", "All required checks have passed", "Checks in progress…", "Branch has conflicts that must be resolved", "Review has conversations that must be resolved" (`CollaborationToolsBundle.properties` L113-122). 2024.1 added a CI checks column in the Git Log ([2024.1 release post](https://blog.jetbrains.com/idea/2024/04/intellij-idea-2024-1/)).                              |
| **Reactions, emoji, mentions**       | —                                                                                                                                                                      | GraphQL `addReaction` and `removeReaction`; REST `/emojis`; GraphQL `findMentionableUsers`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Draft → ready**                    | —                                                                                                                                                                      | GraphQL `markPullRequestReadyForReview`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## 4. Which version brought what

Sources are the JetBrains blog and What's New pages. Rows marked [search summary] were confirmed only through a search result summary of that JetBrains URL.

| Version         | Feature                                                                                                                                                      | Source                                                                                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2018.3          | First in-IDE list of GitHub PRs                                                                                                                              | [2018.3 EAP post](https://blog.jetbrains.com/idea/2018/10/intellij-idea-2018-3-eap-github-pull-requests-and-more/) [search summary]                                                                                                       |
| 2020.2          | Full PR workflow in a dedicated tool window: browse, assign, merge, timeline, inline comments, submit reviews. GitHub login moves to OAuth.                  | [2020.2 release post](https://blog.jetbrains.com/idea/2020/07/intellij-idea-2020-2-is-released/)                                                                                                                                          |
| 2021.1          | Faster PR creation (Git \| GitHub \| Create Pull Request), PR templates                                                                                      | [2021.1 release post](https://blog.jetbrains.com/idea/2021/04/intellij-idea-2021-1/) [search summary]                                                                                                                                     |
| 2022.1          | Apply or commit suggested changes locally                                                                                                                    | [2022.1 release post](https://blog.jetbrains.com/idea/2022/04/intellij-idea-2022-1/) [search summary]                                                                                                                                     |
| 2023.1          | Redesigned PR tool window: a tab per PR, changed files shown immediately, one primary action button                                                          | [IDEA What's New 2023.1, "Improved code review workflow for GitHub"](https://www.jetbrains.com/idea/whatsnew/2023-1/)                                                                                                                     |
| 2023.2          | GitLab MR support on the same collaboration-tools layer; AI Assistant with commit messages                                                                   | [GitLab support post](https://blog.jetbrains.com/blog/2023/07/26/gitlab-support-in-jetbrains-ide/) [search summary]; [2023.2 release post](https://blog.jetbrains.com/idea/2023/07/intellij-idea-2023-2/) [search summary]                |
| 2024.1          | In-editor Review Mode (GitHub and GitLab), reactions, a create-PR notification after push, CI checks column in the Log                                       | [2024.1 release post](https://blog.jetbrains.com/idea/2024/04/intellij-idea-2024-1/)                                                                                                                                                      |
| 2024.2          | AI "Merge with AI" for conflicts                                                                                                                             | [AI Assistant 2024.2 post](https://blog.jetbrains.com/ai/2024/08/jetbrains-ai-assistant-2024-2/) [search summary]                                                                                                                         |
| 2024.3          | AI-generated PR/MR title and description. Code: EP added 2024-09-11, commit `c792d53f08` "[github] Add an action to generate title and description with AI". | [PyCharm What's New 2024.3, "Title and description generation for pull and merge requests"](https://www.jetbrains.com/pycharm/whatsnew/2024-3/); [IDEA 2024.3 EAP 7](https://blog.jetbrains.com/idea/2024/10/intellij-idea-2024-3-eap-7/) |
| 2024.3 (likely) | Plumbing for AI PR summary and AI review added 2024-10-21/30 (see §6). The summary setting appears with "Affected versions: 2024.3.5" in LLM-16256.          | [LLM-16256](https://youtrack.jetbrains.com/issue/LLM-16256); git history (§6)                                                                                                                                                             |
| 2025.3          | "Mark as reviewed" becomes manual                                                                                                                            | [What's fixed 2025.3](https://blog.jetbrains.com/idea/2025/12/what-s-fixed-in-intellij-idea-2025-3/) [search summary]                                                                                                                     |
| 2026.3          | Open PR in Git worktree                                                                                                                                      | [IJPL-242111](https://youtrack.jetbrains.com/issue/IJPL-242111)                                                                                                                                                                           |

**Gaps.** PR-specific changes in 2021.2–2022.3, 2023.3 and 2025.1–2026.2 could not be traced. The What's New pages for those releases render client-side and returned no content.

## 5. Architecture

### How the GitHub plugin talks to GitHub

**GraphQL v4 is the main channel.** The plugin bundles 40 operations under `GH/resources/graphql/query/` and builds them from 38 shared fragments in `GH/resources/graphql/fragment/`. Path constants are in `GH/src/org/jetbrains/plugins/github/api/GHGQLQueries.kt` L4-45; typed wrappers are in `GHGQLRequests.kt`.

- **Queries:**
  - `issueSearch` (the PR list)
  - `findPullRequest`, `findPullRequestId`, `findPullRequestsByHeadBranch`
  - `pullRequestTimeline`, `pullRequestReviewThreads`, `pullRequestCommits`, `pullRequestFiles`, `pullRequestParticipants`
  - `findPullRequestMergeability` (includes check runs)
  - `findPendingReview`
  - `getPullRequestTemplates`, `getProtectionRules`
  - `getRepositoryCommitStatusShort` and `…Contexts`
  - `findMentionableUsers`, `findOrganizationTeams`, `findUser`, `findRepository`
  - `metrics`
- **Mutations:**
  - `createPullRequest`, `updatePullRequest`, `markPullRequestReadyForReview`
  - `createReview`, `submitReview`, `updateReview`, `deleteReview`
  - `addReviewComment`, `updateReviewComment`, `deleteReviewComment`, `addPullRequestReviewThread`
  - `resolveReviewThread`, `unresolveReviewThread`
  - `markFileAsViewed`, `unmarkFileAsViewed`
  - `addReaction`, `removeReaction`
  - `updateIssueComment`, `deleteIssueComment`
  - `deleteRef`
- **Rate limits.** Each query also selects `rateLimit { ...rates }`, for example `findPullRequestMergeability.graphql`.

**REST v3 handles a smaller set of operations** (`GH/src/org/jetbrains/plugins/github/api/GithubApiRequests.kt`):

| Operation                                            | Endpoint                               | Lines              |
| ---------------------------------------------------- | -------------------------------------- | ------------------ |
| Merge, squash-merge, rebase-merge                    | `PUT /repos/{o}/{r}/pulls/{n}/merge`   | L616-644           |
| Edit title, body or state                            | `PATCH /pulls/{n}`                     | L602-613           |
| Add or remove reviewers                              | `/pulls/{n}/requested_reviewers`       | L655-675           |
| PR changed files                                     | `/pulls/{n}/files`                     | L646-652           |
| Commit files, compare (merge base), raw diff         | `/commits/{ref}`, `/compare/{a}...{b}` | L313-350           |
| Top-level PR comment                                 | issue comments API                     | L517-535           |
| Labels and assignees                                 | issues API                             | L492-515, L566-578 |
| Collaborators, assignees, labels, contributors lists |                                        | L352-440           |
| Emojis                                               | `/emojis`                              | L738-750           |

Where each is used: `GH/src/org/jetbrains/plugins/github/pullrequest/data/service/GHPRDetailsServiceImpl.kt`, `GHPRChangesServiceImpl.kt`, `GHPRCommentServiceImpl.kt` and `GHPRRepositoryDataServiceImpl.kt`.

**Local git.** PR commits are fetched with `git fetch` of the PR refspec (`GHPRChangesServiceImpl.kt` L65-70, through `GitCodeReviewUtils.fetch`). The IDE diffs real local revisions; patches from the API are a fallback (`loadPatch`, L113).

**Plugin layering.** The plugin is split into data services (`pullrequest/data/service/*`), data providers (`pullrequest/data/provider/*`) and coroutine/StateFlow view models (`pullrequest/ui/**/…ViewModel.kt`). Swing component factories render the view models.

### Shared collaboration-tools layer

- **What it holds.** `platform/collaboration-tools` holds the provider-neutral pieces. Packages in `CT/src/com/intellij/collaboration/` and `CT/shared/src/...`:
  - HTTP and GraphQL client helpers: `api/graphql`, `api/httpclient`
  - Auth: account managers, OAuth base, login UI
  - Review tool window scaffolding: `ui/toolwindow/ReviewToolwindow*`
  - Review list and search: `ui/codereview/list`, `…/list/search`
  - Details: `ui/codereview/details`
  - Diff: `ui/codereview/diff`
  - In-editor review gutter and inlays: `ui/codereview/editor/CodeReviewEditor*`
  - Timeline and comment threads: `ui/codereview/timeline`, `…/comment`
  - Submit-review popup: `ui/codereview/review/CodeReviewSubmit*`
  - Create-review UI: `ui/codereview/create`
  - Shared strings: CI status, Review Mode, Resolve/Unresolve
- **Who uses it.** The **GitLab** plugin (`plugins/gitlab`) depends on the same module (`plugins/gitlab/gitlab-core/resources/intellij.vcs.gitlab.backend.xml` L24). GitLab has its own AI title EP, `intellij.vcs.gitlab.titleGenerator` (L62).
- **Space.** The community repo now holds only `plugins/space/jps-plugin`, so the Space review client is not present in open source. Its current status was not verified.
- **API stability.** Much of the layer is marked **`@ApiStatus.Experimental`** at package level, for example `CT/src/com/intellij/collaboration/ui/toolwindow/package-info.java` and `CT/shared/src/com/intellij/collaboration/ui/codereview/editor/package-info.java`. The module's `api-dump-experimental.txt` has 1,202 lines, against 381 in `api-dump.txt`.

## 6. JetBrains AI and PR review

### 6.1 Hooks in the open-source GitHub plugin

Three extension points are declared in `GH/resources/intellij.vcs.github.xml` L68-79. All three interfaces are `@ApiStatus.Internal`.

1. **`intellij.vcs.github.titleAndDescriptionGenerator`**, interface `GHPRTitleAndDescriptionGeneratorExtension`.
   - Defined in `GH/src/org/jetbrains/plugins/github/pullrequest/ui/toolwindow/create/GHPRCreateTitleAndDescriptionGenerationViewModel.kt` L21-34.
   - Signature: `generate(project, commits: List<VcsCommitMetadata>, template: String?): Flow<GenerationState>`. **The plugin passes the PR's commit metadata and the repository PR template.** The interface does not pass the diff; whether the AI Assistant implementation loads the diff itself is unverified.
   - Streams `GenerationStep(title, description)`, then `GenerationDone(score)`, which drives the helpful yes/no feedback.
   - Wired in `GHPRCreateViewModel.kt` L225-240. The UI adds a toolbar from the action group `GitHub.Pull.Request.Create.Title.Actions` (`GHPRCreateComponentFactory.kt` L199-215). That group is empty in the community descriptor (`intellij.vcs.github.xml` L366); AI Assistant contributes the button.
2. **`intellij.vcs.github.aiReviewExtension`**, interface `GHPRAIReviewExtension`.
   - Defined in `GH/src/org/jetbrains/plugins/github/ai/GHPRAIReviewExtension.kt` L18-39.
   - Provides:
     - a review view model (`loadReview()`, `getAICommentsForDiff(...)`);
     - per-file AI comment view models built from `RefComparisonChange` plus `GitTextFilePatchWithHistory`;
     - a Swing AI thread component;
     - an "AI review" action component.
   - AI comments (`GHPRAICommentViewModel.kt`) carry `textHtml` and a `DiffLineLocation`. They support `accept()` ("Create the actual comment on the server"), `reject()`, `startChat()` and a per-comment chat with `summarize()`.
   - Placement: the action appears in the PR details status/checks panel (`GHPRStatusChecksComponentFactory.kt` L90-93). Comments render in the diff (`GHPRDiffReviewViewModel.kt` L116-117) and as editor inlays (`editorInlaysRenderers.kt` L49).
   - Only one implementation is used (`singleExtensionFlow`).
3. **`intellij.vcs.github.aiSummaryExtension`**, interface `GHPRAISummaryExtension`.
   - Defined in `GH/src/org/jetbrains/plugins/github/ai/GHPRAISummaryViewModel.kt` L16-79.
   - "A summary that can be generated at the top of the timeline." It supports start, stop, streaming steps and rating useful or not useful.
   - Wired into the PR timeline at `GHPRFileEditorComponentFactory.kt` L131-132 and into `GHPRViewModelContainerImpl.kt` L84-89.

**Git history of the AI hooks** (GitHub commit search, `repo:JetBrains/intellij-community [ghai]`):

- 2024-10-21: `606d620075` "[collab/ghai] AI code review buddy prototype"; `d4f5ea86a9` "[ghai] Move AI review into LLM plugin module"; **`d6de937336` "[ghai] Make review buddy only available internally for now"**; `482b2862ef` "[ghai] Split AI-related functionality to be able to disable AIA".
- 2024-10-30: `c765419083` "[ghai] Add a way to generate a summary of a PR with AI".
- 2025-04-08: `0a967f9219`, multi-line comment check (IJPL-72847).

Conclusion: the AI review "buddy" (AI comments inline in the PR diff) lives in the closed-source AI Assistant ("LLM") plugin and was internal-only in October 2024. **Whether it is user-visible in 2026.x could not be verified.** The public AI Assistant docs do not mention it (§6.2).

### 6.2 AI Assistant features (user-facing)

Source for all of this subsection unless noted: [AI Assistant docs: AI in version control](https://www.jetbrains.com/help/ai-assistant/ai-in-vcs-integration.html).

| Feature                         | Entry point                                                                                                        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PR/MR title and description** | Create Pull Request / Merge Request view, button **"Generate a Title and Description with AI Assistant"**          | Section "Generate title and description for pull and merge requests". Since 2024.3 (§4). The docs do not say what context is sent; per the EP (§6.1) the plugin supplies commits and the template. Custom prompts for it are an **open request** ([LLM-18019](https://youtrack.jetbrains.com/issue/LLM-18019), [LLM-13994](https://youtrack.jetbrains.com/issue/LLM-13994)).                                                                                                                      |
| **PR summary on open**          | Settings \| Tools \| AI Assistant > Features > **"GitHub Plugin: Generate a summary upon opening a Pull Request"** | Options: verbosity, formality tone, personality, customisation prompt; **Regenerate** is available. [LLM-16256](https://youtrack.jetbrains.com/issue/LLM-16256) (setting not persisting) was fixed in 2025.3. [LLM-26558](https://youtrack.jetbrains.com/issue/LLM-26558) (open) describes this as "a pull request summary and brief code review on opening a PR" and asks for follow-up chat, which does not exist. The setting names only the GitHub plugin; no GitLab MR equivalent was found. |
| **Commit message**              | Commit tool window: **"Generate Commit Message with AI Assistant"**                                                | Prompt is customisable in Settings \| Tools \| AI Assistant ("Prompt for generation") and in Prompt Library > Commit Message Generation (`$GIT_BRANCH_NAME`). The docs say the diff is used. First shipped in 2023.2.                                                                                                                                                                                                                                                                             |
| **Improve commit message**      | Git log > Edit Commit Message > **"Improve Commit Message with AI Assistant"**                                     | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Self-review**                 | **"Self-Review with AI"** in the Commit tool window (uncommitted changes) or the Git tool window (a commit)        | Results appear in the Problems tool window, **AI Self-Review** tab. Rules file: Settings \| Tools \| AI Assistant \| Project Settings > **"Path to rules for AI Self-Review"**. This field was formerly "Path to guidelines"; [LLM-17990](https://youtrack.jetbrains.com/issue/LLM-17990) is open, reporting that setting had no effect. This is local review, not posted to GitHub.                                                                                                              |
| **Explain commit**              | Git log, right-click > **"Explain Commit with AI Assistant"**                                                      | Git and Mercurial only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Merge conflicts**             | Merge Revisions dialog: **"Merge with AI"**                                                                        | Since AI Assistant 2024.2 (§4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Shelf title**                 | Shelve Silently                                                                                                    | Toggle: "Generate a title for the shelved changelist".                                                                                                                                                                                                                                                                                                                                                                                                                                            |

**Configuration points:**

- **Project rules** are `.aiassistant/rules/*.md`, managed in Settings \| Tools \| AI Assistant \| Rules. Modes: Always, Manually, By model decision, By file patterns, Off. The docs scope rules to chat. Source: [configure-project-rules](https://www.jetbrains.com/help/ai-assistant/configure-project-rules.html).
- **Prompt Library** is at Settings \| Tools \| AI Assistant \| Prompt Library. It holds editable built-in prompts and custom AI Actions, with variables `$SELECTION` and `$GIT_BRANCH_NAME`. Source: [prompt-library](https://www.jetbrains.com/help/ai-assistant/prompt-library.html).
- **Self-review rules path** is the separate setting listed in the table above.
- **Backend.** A YouTrack error trace shows the PR summary calls `api.jetbrains.ai` ([LLM-21780](https://youtrack.jetbrains.com/issue/LLM-21780), fixed in 2026.1).

**Licensing** ([licensing-and-subscriptions](https://www.jetbrains.com/help/ai-assistant/licensing-and-subscriptions.html)):

- Tiers:
  - AI Free: 3 credits per 30 days.
  - AI Pro: $10/month individual, $20/month organisation.
  - AI Ultimate: $30/month or $60/month.
  - AI Enterprise.
  - 1 credit = $1. Commit message generation costs about 140 requests per credit.
- The credit cost of PR title/description, PR summary, self-review and Merge with AI is **not published**.

**Data handling** ([settings-reference-data-sharing](https://www.jetbrains.com/help/ai-assistant/settings-reference-data-sharing.html)):

- The setting is "Send detailed code-related data" at Settings \| Appearance & Behavior \| System Settings \| Data Sharing. It is opt-in.
- When it is off, code goes to the LLM provider and is not stored by JetBrains.

### 6.3 Junie

- **Local review.** The CLI `/review` (or `junie --review`) reviews changes against main, the last commit, staged or unstaged changes, a commit, a branch, a range, or the last N commits. Findings are grouped by file, with `[CRITICAL]` tags and applicable suggestions. It respects project guidelines. Source: [Junie review agent](https://junie.jetbrains.com/docs/junie-review-agent.html).
- **On GitHub.**
  - JetBrains publishes the **Junie GitHub Action**: [repo](https://github.com/JetBrains/junie-github-action), [docs](https://junie.jetbrains.com/docs/junie-on-github.html).
  - Triggers: `@junie-agent` mentions (configurable `trigger_phrase`), an assignee, the `junie` label, and `issue_comment`, `pull_request_review_comment`, `issues` and `pull_request_review` events.
  - It implements issues as PRs, reviews with inline comments, resolves conflicts and analyses CI failures.
  - Auth: `JUNIE_API_KEY`, or bring-your-own OpenAI, Anthropic, Google, Grok or OpenRouter keys.
  - Guidelines input `junie_guidelines_filename` (default `.junie/guidelines.md`).
- **Automated PR review.** Workflow `.github/workflows/code-review.yml` on `pull_request: [opened, synchronize, reopened]` with `prompt: "code-review"` or custom criteria, and `use_single_comment`. It posts a summary comment plus inline comments, and reviews changed lines only, with no build or tests. On demand: `@junie-agent code-review`. Source: [automated-code-reviews](https://junie.jetbrains.com/docs/automated-code-reviews.html).
- **GitLab.** The equivalent runs through CI/CD: auto-review on MR open and a `code-review` keyword. Source: [junie-gitlab-ci-cd](https://junie.jetbrains.com/docs/junie-gitlab-ci-cd.html) [search summary].
- **Guidelines precedence.** `.junie/AGENTS.md` comes first. Otherwise `AGENTS.md` plus `.junie/playbook.md` and `.junie/rules/*.md`. Otherwise the legacy `.junie/guidelines.md`. Source: [guidelines-and-memory](https://junie.jetbrains.com/docs/guidelines-and-memory.html).
- **Timeline:**
  - "Junie on GitHub" EAP, July 2025 ([blog](https://blog.jetbrains.com/junie/2025/07/the-agentic-ai-era-at-jetbrains-is-here/)).
  - Junie CLI Beta, March 2026 ([blog](https://blog.jetbrains.com/junie/2026/03/junie-cli-the-llm-agnostic-coding-agent-is-now-in-beta/)).
  - Junie out of Beta, June 2026 ([blog](https://blog.jetbrains.com/junie/2026/06/junie-coding-agent-out-of-beta/)).
- **No IDE link was found.** Nothing in the GitHub plugin source references Junie. A Junie review posted on GitHub shows up in the IDE only as ordinary PR review comments (inference).

### 6.4 Other JetBrains GitHub-side tooling

- **Qodana.** [`JetBrains/qodana-action`](https://github.com/JetBrains/qodana-action) is static analysis, not AI. It posts a PR summary comment and annotations, uploads SARIF and enforces quality gates.
- **No AI review GitHub App.** No separate JetBrains "AI review" GitHub App was found.
- **JetBrains Air.** The EAP (October 2026, [blog](https://blog.jetbrains.com/ai/2026/10/air-in-ides-eap/)) does not mention PR review.

## 7. Known limitations and open YouTrack issues

Votes are as of 2026-10-12, from the `youtrack.jetbrains.com` REST API. All issues listed are open unless marked otherwise.

**Pull request review UX:**

| Issue                                                           | Votes | Summary                                                    |
| --------------------------------------------------------------- | ----- | ---------------------------------------------------------- |
| [IJPL-72769](https://youtrack.jetbrains.com/issue/IJPL-72769)   | 39    | Double-clicking a file opens the diff for all files        |
| [IJPL-74211](https://youtrack.jetbrains.com/issue/IJPL-74211)   | 34    | Cannot select more than one commit for the diff            |
| [IJPL-72813](https://youtrack.jetbrains.com/issue/IJPL-72813)   | 25    | No PRs from multiple repositories at once                  |
| [IJPL-72782](https://youtrack.jetbrains.com/issue/IJPL-72782)   | 24    | Cannot create suggested changes from local edits           |
| [IJPL-80758](https://youtrack.jetbrains.com/issue/IJPL-80758)   | 24    | No "Show changes since last review"                        |
| [IJPL-180862](https://youtrack.jetbrains.com/issue/IJPL-180862) | 16    | No timeline filtering                                      |
| [IJPL-72793](https://youtrack.jetbrains.com/issue/IJPL-72793)   | 16    | No file-level comments                                     |
| [IJPL-72949](https://youtrack.jetbrains.com/issue/IJPL-72949)   | 15    | Comments not shown in diff in some cases                   |
| [IJPL-74187](https://youtrack.jetbrains.com/issue/IJPL-74187)   | 13    | No auto-merge                                              |
| [IJPL-72979](https://youtrack.jetbrains.com/issue/IJPL-72979)   | 12    | Better suggestion authoring                                |
| [IJPL-190554](https://youtrack.jetbrains.com/issue/IJPL-190554) | 11    | Comments invisible on renamed files                        |
| [IJPL-176633](https://youtrack.jetbrains.com/issue/IJPL-176633) | 10    | Review of branches containing merge commits                |
| [IJPL-72815](https://youtrack.jetbrains.com/issue/IJPL-72815)   | —     | Multi-line comments broken in the editor                   |
| [IJPL-208882](https://youtrack.jetbrains.com/issue/IJPL-208882) | —     | Drag the "+" button for multi-line comments                |
| [IJPL-74214](https://youtrack.jetbrains.com/issue/IJPL-74214)   | —     | Re-request review                                          |
| [IJPL-229475](https://youtrack.jetbrains.com/issue/IJPL-229475) | —     | Cannot submit a review on a draft PR from the details view |
| [IJPL-74234](https://youtrack.jetbrains.com/issue/IJPL-74234)   | —     | Convert to draft                                           |
| [IJPL-242806](https://youtrack.jetbrains.com/issue/IJPL-242806) | —     | Jump to definition in the PR diff                          |
| [IJPL-243186](https://youtrack.jetbrains.com/issue/IJPL-243186) | —     | PR tab state loss                                          |
| [IJPL-74105](https://youtrack.jetbrains.com/issue/IJPL-74105)   | 54    | GitHub notifications                                       |

- IJPL-74214: the plugin now has a `GHPRReRequestReviewAction` class, so this may be partly addressed. Unverified.

**CI status:**

- [IJPL-162472](https://youtrack.jetbrains.com/issue/IJPL-162472): checks shown as passed when they failed.
- [IJPL-175138](https://youtrack.jetbrains.com/issue/IJPL-175138): cancelled workflows are misreported.
- [IJPL-219878](https://youtrack.jetbrains.com/issue/IJPL-219878): the checks popup is stale.
- Structural limit in the code: only the **last** commit's checks are loaded, capped at 100 check suites × 100 runs (§3).

**Authentication:** see §2.

**AI:**

| Issue                                                                                                                    | Status         | Summary                                                                   |
| ------------------------------------------------------------------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------- |
| [LLM-18019](https://youtrack.jetbrains.com/issue/LLM-18019), [LLM-13994](https://youtrack.jetbrains.com/issue/LLM-13994) | open           | Custom prompts for PR title and description                               |
| [LLM-26558](https://youtrack.jetbrains.com/issue/LLM-26558)                                                              | open           | No follow-up chat on the PR summary                                       |
| [LLM-1912](https://youtrack.jetbrains.com/issue/LLM-1912)                                                                | open           | AI code review for pull requests                                          |
| [LLM-23](https://youtrack.jetbrains.com/issue/LLM-23)                                                                    | open           | LLM review of selected commits                                            |
| [LLM-548](https://youtrack.jetbrains.com/issue/LLM-548)                                                                  | open           | PR change summary, 15 votes; overlaps the summary feature that now exists |
| [LLM-17990](https://youtrack.jetbrains.com/issue/LLM-17990)                                                              | open           | Guidelines path has no effect                                             |
| [LLM-17466](https://youtrack.jetbrains.com/issue/LLM-17466)                                                              | Verified       | Title/description generation did nothing, in 2025.1.2                     |
| [LLM-21780](https://youtrack.jetbrains.com/issue/LLM-21780)                                                              | Done in 2026.1 | PR summary errored with HTTP 400                                          |

## 8. Extension points for a third-party plugin

**What the source supports:**

1. **The GitHub-specific AI EPs exist but are internal.**
   - `intellij.vcs.github.titleAndDescriptionGenerator`, `intellij.vcs.github.aiReviewExtension` and `intellij.vcs.github.aiSummaryExtension` are declared `dynamic="true"` (`intellij.vcs.github.xml` L69-78).
   - Their interfaces are `@ApiStatus.Internal`.
   - The review and summary EPs take only a **single** extension (`singleExtensionFlow`), so a third-party implementation would conflict with AI Assistant. The title EP uses the first registered extension.
   - Technically these are the closest seams for a "dear reviewer"-style tool: inline AI comments with accept/reject that become real GitHub comments, a timeline summary, and a create-PR generator. They are not a supported API, and Marketplace verification flags internal-API use (general platform policy; not checked against a specific doc here).
2. **Public EPs in the GitHub plugin:**
   - `com.intellij.vcs.github.gistContentsCollector`
   - `com.intellij.github.ghShareProjectCompatibilityExtension` ("Removal pending after 2025.2")
   - Neither is PR-related (L80-87).
3. **Action groups you can add to with `<add-to-group>`.** This is the most stable route; the action ids are public.
   - `Github.PullRequest.ToolWindow.List.Popup` (PR list context menu)
   - `Github.PullRequest.Details.Popup`
   - `Github.PullRequest.Changes.Toolbar` and `Github.PullRequest.Changes.Popup`
   - `Github.PullRequest.Timeline.Popup`
   - `Github.Pull.Request.Branch.Popup.Actions`
   - `GitHub.Pull.Request.Create.Title.Actions` (create-PR title toolbar; AI Assistant uses it)
   - Defined in `intellij.vcs.github.xml` L272-366.
   - **Unverified:** whether the action data context exposes the selected PR or diff view model through public `DataKey`s. `GHPRCreateTitleAndDescriptionGenerationViewModel.DATA_KEY` exists but is internal.
4. **Platform-level EPs the GitHub plugin itself implements, which others can also implement:**
   - `diff.DiffExtension` (GitHub uses `GHPRReviewDiffExtension`, L114).
   - Editor factory listeners (`GHPRReviewInEditorController$InstallerListener`, L117).
   - Git4Idea EPs such as `gitRepositoryHostingService`, `gitProtectedBranchProvider` and `gitPushNotificationCustomizer` (L174-187).
   - These let a plugin add its own inlays or diff decorations alongside GitHub's, without touching its internals.
5. **Collaboration-tools.**
   - Reusable but mostly **`@ApiStatus.Experimental`** (§5).
   - Platform actions `CodeReview.NextComment`, `CodeReview.PreviousComment` and `Code.Review.Editor.New.Comment` (`CT/shared/resources/intellij.platform.collaborationTools.shared.xml` L45-65).
   - A plugin could build its own review tool window on `ReviewToolwindow*` and `CodeReviewEditor*`, as GitLab does.
6. **Outside the IDE.** Anything posted to GitHub as a normal review or comment (for example by a GitHub Action, as Junie does) appears in the PyCharm PR UI automatically through GraphQL. This is the only fully supported integration path.

## Could not verify

- **AI review in the PR diff.** Whether the AI review "buddy" is user-visible in any 2026.x release, and under which name or button. The code made it internal-only in October 2024; the public docs are silent.
- **AI context sent.** What the AI PR title/description and PR summary features send. Inference from the EP: commits plus template for the title; summary unknown. The docs do not say, and the implementation is closed source.
- **Credit cost per AI feature**, except commit messages.
- **Release dates.** When "Explain Commit", "Self-Review with AI" and the PR summary first shipped. Also PR changes in 2021.2–2022.3, 2023.3 and 2025.1–2026.2, because those What's New pages render client-side.
- **OAuth for GitHub Enterprise.** A summarised read of the docs suggested GHE supports OAuth. The current code and the open IJPL-182218 say it is token-only. This report goes with the code.
- **Rules scope.** Whether `.aiassistant/rules` affects commit or PR generation or self-review.
- **Space.** The status of the Space code-review client; it is not in open source.
- **Closed-source modules.** The contents of `intellij.vcs.github.ultimate.*`.
- **Junie GitHub Action details.** Its current release or GA status, whether it is still limited to some languages, and what the "JUNP" licence is.
- **Tool window keyboard shortcuts** beyond those documented (Ctrl+F5, Ctrl+D, F4).

## Sources

**JetBrains docs:**

- PyCharm: [Work with GitHub pull requests](https://www.jetbrains.com/help/pycharm/work-with-github-pull-requests.html); [Set up a GitHub account](https://www.jetbrains.com/help/pycharm/set-up-a-github-account.html)
- IntelliJ IDEA: [Work with GitHub pull requests](https://www.jetbrains.com/help/idea/work-with-github-pull-requests.html); [Set up a GitHub account](https://www.jetbrains.com/help/idea/set-up-a-github-account.html)
- AI Assistant: [AI in version control](https://www.jetbrains.com/help/ai-assistant/ai-in-vcs-integration.html); [Project rules](https://www.jetbrains.com/help/ai-assistant/configure-project-rules.html); [Prompt Library](https://www.jetbrains.com/help/ai-assistant/prompt-library.html); [Licensing](https://www.jetbrains.com/help/ai-assistant/licensing-and-subscriptions.html); [Data sharing](https://www.jetbrains.com/help/ai-assistant/settings-reference-data-sharing.html)
- Junie: [Review agent](https://junie.jetbrains.com/docs/junie-review-agent.html); [Junie on GitHub](https://junie.jetbrains.com/docs/junie-on-github.html); [Automated code reviews](https://junie.jetbrains.com/docs/automated-code-reviews.html); [GitLab CI/CD](https://junie.jetbrains.com/docs/junie-gitlab-ci-cd.html); [Guidelines and memory](https://junie.jetbrains.com/docs/guidelines-and-memory.html)

**Release notes and blog:**

- [PyCharm What's New 2024.3](https://www.jetbrains.com/pycharm/whatsnew/2024-3/)
- [IDEA What's New 2023.1](https://www.jetbrains.com/idea/whatsnew/2023-1/)
- Release posts: [2018.3 EAP](https://blog.jetbrains.com/idea/2018/10/intellij-idea-2018-3-eap-github-pull-requests-and-more/), [2020.2](https://blog.jetbrains.com/idea/2020/07/intellij-idea-2020-2-is-released/), [2021.1](https://blog.jetbrains.com/idea/2021/04/intellij-idea-2021-1/), [2022.1](https://blog.jetbrains.com/idea/2022/04/intellij-idea-2022-1/), [2023.2](https://blog.jetbrains.com/idea/2023/07/intellij-idea-2023-2/), [GitLab support](https://blog.jetbrains.com/blog/2023/07/26/gitlab-support-in-jetbrains-ide/), [2024.1](https://blog.jetbrains.com/idea/2024/04/intellij-idea-2024-1/), [2024.3 EAP 7](https://blog.jetbrains.com/idea/2024/10/intellij-idea-2024-3-eap-7/), [AI Assistant 2024.2](https://blog.jetbrains.com/ai/2024/08/jetbrains-ai-assistant-2024-2/), [What's fixed 2025.3](https://blog.jetbrains.com/idea/2025/12/what-s-fixed-in-intellij-idea-2025-3/)
- Junie and AI blog: [Junie July 2025](https://blog.jetbrains.com/junie/2025/07/the-agentic-ai-era-at-jetbrains-is-here/), [Junie CLI Beta](https://blog.jetbrains.com/junie/2026/03/junie-cli-the-llm-agnostic-coding-agent-is-now-in-beta/), [Junie out of Beta](https://blog.jetbrains.com/junie/2026/06/junie-coding-agent-out-of-beta/), [Air in IDEs EAP](https://blog.jetbrains.com/ai/2026/10/air-in-ides-eap/)

**Marketplace and GitHub:**

- [GitHub plugin](https://plugins.jetbrains.com/plugin/13115-github) (data from `https://plugins.jetbrains.com/api/plugins/13115` and `/updates`)
- [JetBrains/junie-github-action](https://github.com/JetBrains/junie-github-action); [JetBrains/qodana-action](https://github.com/JetBrains/qodana-action)

**Source code** ([intellij-community @ 5f40c823bf](https://github.com/JetBrains/intellij-community/tree/5f40c823bf599a425aecb253d990fa94494e5d46)):

- `plugins/github/github-core/`: `resources/META-INF/plugin.xml`, `resources/intellij.vcs.github.xml`, `resources/messages/GithubBundle.properties`, `resources/graphql/{query,fragment}/*`, `src/org/jetbrains/plugins/github/{ai,api,authentication,pullrequest}/**`
- `platform/collaboration-tools/` (`src`, `shared/src`, `shared/resources/messages/CollaborationToolsBundle.properties`, `api-dump*.txt`)
- `plugins/gitlab/gitlab-core/resources/intellij.vcs.gitlab.backend.xml`
- Commits: `c792d53f08`, `606d620075`, `d4f5ea86a9`, `d6de937336`, `482b2862ef`, `c765419083`, `9df299674a`

**YouTrack:**

- GitHub plugin issues: IJPL-72769, 74211, 72813, 72782, 80758, 180862, 72793, 72949, 74187, 72979, 190554, 176633, 72815, 208882, 74214, 229475, 74234, 242806, 243186, 74105, 162472, 175138, 219878, 182218, 179595, 238890, 246282, 72809, 185994, 79822, 242111
- AI Assistant issues: LLM-16256, 17466, 18019, 13994, 26558, 1912, 23, 548, 17990, 21780
- All at `https://youtrack.jetbrains.com/issue/<ID>`.
