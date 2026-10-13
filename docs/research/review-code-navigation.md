# Code navigation while reviewing a pull request: VS Code, JetBrains, and a standalone macOS app

Researched on 2026-10-12. This note covers go-to-definition (cmd+click), find usages, jumping between files, and keeping several diffs open while reviewing a PR. It does not repeat the general JetBrains PR feature inventory in [`pycharm-github-pr-review.md`](pycharm-github-pr-review.md); read that first for the tool window, authentication and AI hooks.

**Source pins.** Code references point at these commits:

| Repo | Commit | Committed | Abbreviation used below |
|---|---|---|---|
| `microsoft/vscode-pull-request-github` (v0.168.0) | [`596015ab3d`](https://github.com/microsoft/vscode-pull-request-github/tree/596015ab3d8cd0c4fe0aed14230bfe91c1263881) | 2026-10-12 | `PRX/` |
| `microsoft/vscode` | [`acf9515dc1`](https://github.com/microsoft/vscode/tree/acf9515dc162bc16075da6a48ca859bf37daa65e) | 2026-10-13 UTC | `VSC/` |
| `JetBrains/intellij-community` | [`5f40c823bf`](https://github.com/JetBrains/intellij-community/tree/5f40c823bf599a425aecb253d990fa94494e5d46) | 2026-10-13 UTC (same pin as the PyCharm note) | `IJ/` |
| `microsoft/pyright` | [`79cd772619`](https://github.com/microsoft/pyright/tree/79cd772619fa33f28d3e274665d6355193850f6f) | 2026-10-12 | `PYR/` |

To turn a reference into a link, replace the abbreviation with `https://github.com/<repo>/blob/<commit>/` and append `#L<n>`. Within `IJ/`, `GH/` means `plugins/github/github-core/src/org/jetbrains/plugins/github/`.

**Labels.** **[inference]** marks my reasoning from the cited code or docs, not something a source states. **[unverified]** marks something I could not confirm. **[maintainer comment]** marks a statement by a project maintainer in an issue tracker, which is weaker than docs or code.

## Summary

- **The user's claim about VS Code is wrong.** The GitHub Pull Requests extension has a changed-files tree in two places. Every PR in the **Pull Requests** list expands into its changed files, shown as a tree by default (`githubPullRequests.fileListLayout: "tree"`). After checkout, a separate **Changes In Pull Request** view lists files and commits. That second view lives in its own activity-bar container, "GitHub Pull Request", which only appears in review mode. That may explain why the user missed it **[inference]**.
- **VS Code navigation in PR diffs depends on checkout.**
  - **Checked out:** the right (head) side of each diff is the real workspace file (`file:` URI). The language extension treats it like any other file, so go-to-definition and find references work across the project. The VS Code docs say so: "Local navigation, IntelliSense, and editing are available in this checked-out workflow."
  - **Not checked out:** both sides are virtual `pr:` documents. Pyright registers only for `file:` and `untitled:` documents, so Python gets no navigation there. TypeScript gets syntax-level features only. The maintainer's summary: navigation works when "the definition is part of the PR or the PR is checked out".
  - **Left (base) side:** always a virtual `review:` or `pr:` document, so cross-project navigation from it does not work **[inference]**.
- **VS Code can show many diffs at once.** Each diff is an ordinary editor tab, which you can split into as many groups as you like. There is also a **multi-diff editor** showing every file in the PR in one scrolling view ("Open All Diffs"; the default checkout layout is `focusedMode: "multiDiff"`). Diffs from different PRs can be open at the same time.
- **JetBrains: navigation in the PR diff partly works, and the user's complaint is partly true.**
  - Both sides of a PR diff are git revisions, not the local file, even when the branch is checked out. They are built with `GitContentRevision.createRevision(...)`.
  - The platform turns revision text into an in-memory "outsider" file. That file resolves references against the **current local project index**, which is "often a good enough approximation" (the comment in `SyntheticPsiFileSupport`).
  - So cmd+click can work for symbols that exist in your checked-out code. JetBrains support could not reproduce a "no jump to definition" report in Java (IJPL-242806).
  - It fails, or misleads, in three cases: symbols that exist only in the PR revision, **Find Usages invoked on a definition** (IJPL-100530), and the left side generally (IJPL-255214, IJPL-79824).
  - Behaviour differs by language plugin. The IJPL-242806 reporter used RustRover. Python is **[unverified]**.
- **JetBrains has full navigation only in Review Mode.** In Review Mode you review in the real editor, after checkout, with gutter markers and comments. Review Mode turns on only for **the PR whose branch is current**, and only when the PR head commit is in the local history. So one PR at a time per project window.
- **JetBrains diff tabs: one per PR.** The diff tab is a virtual file keyed by (repository, PR number), so two PRs can each have a diff tab **[inference from code]**. Within one PR, a single tab shows either one file at a time or, with the combined-diff advanced setting, all files stacked. You cannot open two files of the same PR as separate diff tabs **[inference from code; UI not tested]**. The 2026.3 "Open in Worktree" action is the supported way to get a second fully indexed checkout.
- **A JetBrains plugin cannot realistically fix this through `DiffExtension`.** The extension point exposes the viewer's editors, so a plugin could add actions. But resolve against a revision that is not checked out needs an index of that revision, which the IDE builds only for open projects. The realistic plugin moves are:
  - map the caret to the local file and navigate there (what F4 already does);
  - open the PR in a worktree and navigate there.

  **[inference]**
- **A standalone macOS app with real navigation needs a checkout.** The app needs a local checkout (a `git worktree` at `pull/N/head`) and a language server or a precomputed index.
  - **GitHub's code navigation is not usable.** It is now search-based only: precise, stack-graphs navigation was "unshipped" from the docs in December 2024, and `github/stack-graphs` was archived in September 2025. It has no API. Code search covers only the default branch.
  - **Cheapest high-fidelity path:** run a language server on the head worktree and embed Monaco or CodeMirror 6, both of which have LSP clients. Use Pyright, basedpyright, Pyrefly or ty for Python, and `typescript-language-server` or the TypeScript 7 native LSP for TypeScript.
  - **Cheapest overall:** "open in my IDE at file:line", using `code --goto` / `vscode://file/...` or `pycharm --line`.

## Comparison table

| | VS Code + GitHub Pull Requests (not checked out) | VS Code + GitHub Pull Requests (checked out) | JetBrains PR diff | JetBrains Review Mode (editor) | Standalone app (proposed) |
|---|---|---|---|---|---|
| **Go to definition, head side** | Partial. TS within the virtual document only; none for Python (Pyright selector is `file`/`untitled`) | **Yes, full.** The right side is the real `file:` document | **Partial.** Resolves against the *local* index; good when local ≈ PR head and the symbol exists locally | **Yes, full** (real editor) | Depends on the engine: LSP on a head worktree ≈ full; tree-sitter/ctags = name match |
| **Go to definition, base side** | Partial (as left) | No cross-file navigation (`review:` scheme) **[inference]** | Weak; IJPL-255214, IJPL-79824 | Not applicable (base shown only in a gutter popup) | Needs a second worktree and server at the merge base |
| **Find usages from a definition** | No | Yes (head side) | **No** ("Cannot search for usages from this location", IJPL-100530) | Yes | LSP: yes. Index: yes (SCIP). Name-match: approximate |
| **Requires checkout** | n/a | Yes (or a worktree) | Works without checkout, but resolves against whatever is checked out | Yes, and the PR head must be in local history | Yes (the app makes its own worktree) |
| **Several diffs open at once** | Yes: tabs, splits, multi-diff editor; several PRs | Yes, same | One diff tab per PR; one file at a time or combined all-files view | One PR per project window; any number of editor tabs | Your design |
| **Changed-files tree** | Yes, under each PR in the Pull Requests view (tree or flat) | Yes, the "Changes In Pull Request" view (Files + Commits; viewed checkboxes; hide viewed) | Yes, PR tool window changes tree, with commit filter and viewed state | Same tree | Your design |
| **Overview / timeline** | Yes, the Description webview with timeline | Yes | Yes, the Timeline tab | Yes | Your design |

---

## 1. VS Code and the GitHub Pull Requests extension

### 1.1 Is there a changed-files tree? (verifying the user's claim)

**Yes. The claim that there is no PR files view is false.**

- **View containers.** The extension contributes two activity-bar containers: `github-pull-requests` (titled "GitHub") and `github-pull-request` (titled "GitHub Pull Request"). Source: `PRX/package.json` L931-946; titles in `PRX/package.nls.json`.
- **Pull Requests view (`pr:github`)** is in the "GitHub" container (`PRX/package.json` L953). Expanding a PR node lists its changed files.
  - The children are built in `PRNode.getChildren()`. If `githubPullRequests.fileListLayout` is `'tree'`, files are grouped by a `DirectoryTreeNode`; otherwise they are listed flat (`PRX/src/view/treeNodes/pullRequestNode.ts` L95-110).
  - The setting is `"enum": ["flat", "tree"], "default": "tree"` (`PRX/package.json` L298).
- **Changes In Pull Request view (`prStatus:github`)** is in the "GitHub Pull Request" container (`PRX/package.json` L1008; display name `"view.pr.status.github.name": "Changes In Pull Request"`, `PRX/package.nls.json` L220).
  - Its `when` clause includes `github:inReviewMode`, so it appears only after checkout.
  - The root node has two children, `FilesCategoryNode` and `CommitsNode` (`PRX/src/view/treeNodes/repositoryChangesNode.ts` L108-120).
  - The Files node honours the tree/flat layout and `githubPullRequests.hideViewedFiles`, showing "All files viewed" when everything is hidden (`PRX/src/view/treeNodes/filesCategoryNode.ts` L59-110; setting at `PRX/package.json` L307).
- **The VS Code docs agree.** "The **Changes in Pull Request** view lists the changed files and commits." Source: [VS Code docs: Working with GitHub](https://code.visualstudio.com/docs/sourcecontrol/github).
- **Why the user may have missed it [inference]:**
  - Before checkout, the files are nested inside the PR list, not in a separate view.
  - After checkout, the dedicated view appears in a *second* activity-bar icon (`$(git-pull-request)`), not in the PR list container.

**Compared with JetBrains' PR changes tree [inference from both UIs' code and docs]:**

| Feature | VS Code | JetBrains |
|---|---|---|
| Tree/flat toggle | Yes | Directory grouping |
| Viewed state | Viewed checkboxes; `pr.markFileAsViewed`, `PRX/package.json` L1393 | GraphQL `markFileAsViewed` (see the PyCharm note §3) |
| Per-commit files | A separate **Commits** node in the tree | A commit selector filters the same tree |
| Comment decorations | Yes | Yes |
| Overall | Roughly at parity | Roughly at parity |

### 1.2 Does go-to-definition / find references work in PR diff editors?

**The diff sides use different URI schemes depending on checkout.**

| State | Left (base) side | Right (head) side | Source |
|---|---|---|---|
| Not checked out | `pr:` URI | `pr:` URI | `toPRUri(...)` in `PRX/src/view/fileChangeModel.ts` L177-209 (`InMemFileChangeModel`, `isCurrentPR` false); `RemoteFileChangeModel` L212-250 |
| Checked out (the current PR) | `review:` URI at the merge base | the plain workspace file URI (`filePath`, i.e. `file:`); deleted files use `review:` | `PRX/src/view/fileChangeModel.ts` L177-197; same in `PRX/src/view/reviewManager.ts` L1206-1224 |

- **Scheme meanings.** The enum in `PRX/src/common/uri.ts` L806-825:
  - `Review = 'review' // File content for a checked out PR`
  - `Pr = 'pr' // File content from GitHub for non-checkout PR`
- **How a diff opens.** Clicking a file runs `vscode.diff(parentURI, headURI, "<name> (Pull Request)")` (`PRX/src/view/treeNodes/fileChangeNode.ts` L38-62).

**What language extensions do with those schemes:**

- **TypeScript (built-in extension).**
  - Semantic support is limited to `file` plus a few special schemes on desktop (`getSemanticSupportedSchemes()`, `VSC/extensions/typescript-language-features/src/configuration/fileSchemes.ts` L25-44).
  - The "syntax" selector is `{ language }` with no scheme (`VSC/extensions/typescript-language-features/src/languageProvider.ts` L51-61).
  - Definition and reference providers register on `selector.syntax` (`.../languageFeatures/definitions.ts` L67-70; `.../references.ts` L50-53).
  - So TS *will answer* go-to-definition on a `pr:` or `review:` document. Because the document is not a real file in the project, I expect results only within that document or other open virtual documents, not into `node_modules` or other project files **[inference; not tested]**.
- **Python (Pyright).** The open-source Pyright VS Code client's document selector is `{ scheme: 'file', language: 'python' }, { scheme: 'untitled', language: 'python' }` (`PYR/packages/vscode-pyright/src/extension.ts` L102-103). So Pyright provides nothing on `pr:` or `review:` documents.
  - **Pylance** is closed source. Its selector is **[unverified]**. It is "licensed for use in Microsoft products and services only" ([pylance-release FAQ](https://github.com/microsoft/pylance-release/blob/main/FAQ.md) L17).
- **Maintainer statements.**
  - In [vscode-pull-request-github#486](https://github.com/microsoft/vscode-pull-request-github/issues/486#issuecomment-971616864) ("Go to definition would be useful", closed 2021-11-17), the maintainer wrote: "This works now as long: 1) The definition is ~~not~~ part of the PR or 2) The PR is checked out." He later confirmed the strike-through: it is "*is* part of the PR" ([comment](https://github.com/microsoft/vscode-pull-request-github/issues/486#issuecomment-1027764438)). **[maintainer comment]**
  - Diffs opened from the **Pull Requests** list *before* checkout keep their `pr:` URIs and stay without IntelliSense after you check out. You must reopen them from **Changes In Pull Request** ([#486 comment](https://github.com/microsoft/vscode-pull-request-github/issues/486#issuecomment-1157467334); [#3631](https://github.com/microsoft/vscode-pull-request-github/issues/3631), closed 2022-07-14). Whether #3631 fully fixed this was not verified.
- **Docs.** "Local navigation, IntelliSense, and editing are available in this checked-out workflow" ([VS Code docs: Working with GitHub](https://code.visualstudio.com/docs/sourcecontrol/github)).

**Bottom line.**

- **After checkout:** full navigation on the head side, in any language whose extension handles `file:` documents. Go-to-definition opens the real file, so you can jump around freely.
- **Base side:** effectively none across files **[inference]**.
- **Without checkout:** little to none, depending on the language.
- **Parallel PRs:** "Checkout Pull Request in Worktree" (added in 0.140.0, `PRX/CHANGELOG.md`) creates a worktree and offers to open it in a **New Window** or the **Current Window** (`PRX/src/github/worktree.ts` L109-123). That gives a second fully navigable PR checkout in parallel.

### 1.3 Can several PR diffs be open at once?

**Yes.**

- **Ordinary tabs.** Every `vscode.diff` is an ordinary editor. "You can open as many editor groups as you like side by side vertically and horizontally." Single-click opens in a reusable *preview* tab unless `workbench.editor.enablePreview` is off ([VS Code docs: User interface](https://code.visualstudio.com/docs/getstarted/userinterface)).
- **Multi-diff editor.**
  - Command `pr.openAllDiffs`, "Open All Diffs", added in 0.36.0 (`PRX/CHANGELOG.md`; `PRX/package.json` L1134).
  - `pr.openChanges` calls the built-in `vscode.changes` command with the title "Changes in Pull Request #N" (`PRX/src/github/pullRequestModel.ts` L1830-1850). `vscode.changes` "Opens a list of resources in the changes editor to compare their contents" ([built-in commands reference](https://code.visualstudio.com/api/references/commands)).
  - Since 0.80.0, `"githubPullRequests.focusedMode": "multiDiff"` opens this on checkout. It is the current default (`PRX/package.json` L867; `PRX/package.nls.json` L192: "Show all diffs in the pull request").
  - A multi-diff editor can also be opened by URI (0.126.0), and commit links in the description open in it (0.116.0) (`PRX/CHANGELOG.md`).
- **Diffs from different PRs** can be open at the same time, because each is just a tab with its own `pr:` URIs **[inference]**.

### 1.4 Timeline / overview

- **Yes.** Selecting a PR opens its **Description** (`pr.openDescription`, "View Pull Request Description", `PRX/src/view/treeNodes/pullRequestNode.ts` L361-366). This is a webview with the PR overview and review actions ([VS Code docs](https://code.visualstudio.com/docs/sourcecontrol/github)).
- **The timeline** is rendered by `PRX/webviews/components/timeline.tsx`.
- **Layout on checkout.** `focusedMode: "overview"` opens the description on checkout instead of diffs (`PRX/package.nls.json`, `githubPullRequests.focusedMode.overview`).

### 1.5 Extension APIs for a third-party review UI with navigation

All of these are in the stable `vscode.d.ts` (`VSC/src/vscode-dts/vscode.d.ts`) or the built-in commands list.

| Need | API |
|---|---|
| Changed-files tree | `window.createTreeView` (L11703) + `TreeDataProvider`; `window.registerFileDecorationProvider` (L11835) for status badges |
| Content of base/head revisions | `workspace.registerTextDocumentContentProvider(scheme, ...)` (L14266, read-only virtual docs) or `workspace.registerFileSystemProvider` (L14517) |
| Open a diff / all diffs | `vscode.diff` and `vscode.changes` commands ([commands reference](https://code.visualstudio.com/api/references/commands)) |
| Inline review threads | `comments.createCommentController` (L17813) + `CommentingRangeProvider` (L17732), which is what the GitHub extension uses |
| Overview / timeline | `window.createWebviewPanel` (L11547) |
| Query navigation programmatically | `vscode.executeDefinitionProvider`, `vscode.executeReferenceProvider`, `vscode.executeDocumentSymbolProvider`, `vscode.executeWorkspaceSymbolProvider` ([commands reference](https://code.visualstudio.com/api/references/commands)) |
| Provide navigation yourself on a custom scheme | `languages.registerDefinitionProvider` (L14905), `registerReferenceProvider` (L15038) |
| Gutter change markers on real files | `SourceControl.quickDiffProvider` (L16620) |

**The key design point [inference]:** language extensions (Pyright and TS semantic features) only fully serve `file:` documents.

- **For real navigation:** a third-party review extension should put the head revision on disk (a checkout or worktree) and diff `review-scheme base` ↔ `file: head`, as the GitHub extension does.
- **Without a checkout:** the alternative is to implement definition and reference providers for its own scheme, backed by a precomputed index (see §3.3).

The GitHub extension also enables many *proposed* APIs (`enabledApiProposals` in `PRX/package.json`: `tabInputMultiDiff`, `quickDiffProvider`, `commentReactor`, …). Extensions published to the Marketplace cannot use proposed APIs, so a third-party clone would be limited to the stable subset. That Marketplace rule comes from general VS Code policy and was not re-checked here **[unverified]**.

---

## 2. JetBrains IDEs

### 2.1 What the PR diff is built from

- **Both sides are git revisions.** `GHPRDiffChangeViewModel` builds each file's request with `ChangeDiffRequestProducer.create(project, change.createVcsChange(project))` (`IJ/plugins/github/github-core/src/org/jetbrains/plugins/github/pullrequest/ui/diff/GHPRDiffChangeViewModel.kt` L48-52).
  - `createVcsChange` makes **both** sides `GitContentRevision.createRevision(path, revisionNumber, project)` (`IJ/plugins/git4idea/backend/src/changes/GitBranchComparisonResult.kt` L125-129).
  - Neither side is the local working file, even when the PR branch is checked out.
- **Revision text becomes an in-memory "outsider" file.** The diff platform turns revision text into an in-memory `LightVirtualFile` with a PSI document (`IJ/platform/diff-impl/src/com/intellij/diff/DiffContentFactoryImpl.java` L430-460). It marks it with `SyntheticPsiFileSupport.markFile(file, originalFilePath)` (L683-687).
- **What `SyntheticPsiFileSupport` says about itself** (`IJ/platform/analysis-impl/src/com/intellij/codeInsight/daemon/SyntheticPsiFileSupport.java` L19-26):

  > We want to highlight some files, that do not belong to the project (ex: previous revisions from VCS). To do so we need some context - SDK, the rest of the project, etc. We can't get "real" context, but local state is often a good enough approximation. This helper is used to disable error highlighting and inspections in such files, as they tend to be false-positive due to context differences.

**What this means for navigation [inference from the above, consistent with the YouTrack reports below]:**

- **What works.** References in either side resolve against the **currently opened project's index**, which is the checked-out branch. Cmd+click on a symbol that exists locally can jump to the *local* declaration, which opens in the normal editor.
- **What fails or misleads:**
  - Declarations that exist only in the PR revision, or only in the base revision, are not indexed. Navigation to them fails.
  - Find Usages *from* a declaration inside the diff has no indexed element to search from.
  - If the local checkout differs from the PR head, jumps can land on the wrong (local) version.
- **Error highlighting** is deliberately suppressed in these files (`HighlightFilter`, L32-39).

### 2.2 What the YouTrack record shows

Votes and states were read from the `youtrack.jetbrains.com` REST API on 2026-10-12.

| Issue | Votes | State | What it says |
|---|---|---|---|
| [IJPL-242806](https://youtrack.jetbrains.com/issue/IJPL-242806) "Allow for Jump to Definition In PR Review Diff View" | 2 | Open | Reporter (RustRover 2025.3.5, branch checked out): jump to definition "only works for a limited number of cases, e.g., the target variable's definition is within the scope of changes", "even on the right-side part"; must use Jump to Source (F4). JetBrains support (2026-04-16): "I tried to go to declaration/usages from the diff view in a PR, on a symbol that is not included in the current PR changeset" and **could not reproduce** (Java, spring-petclinic). |
| [IJPL-100530](https://youtrack.jetbrains.com/issue/IJPL-100530) | 2 | Open (since 2023-01) | In a PR or branch diff, Show Usages on a *definition* gives "Cannot search for usages from this location…"; on a *usage* it works. Reporter confirms the same with the GitHub plugin and branch diffs. |
| [IJPL-255214](https://youtrack.jetbrains.com/issue/IJPL-255214) "Past version git diff not navigable" | 1 | Open (2026-09) | In every git diff viewer, Find Usages and Go To Declaration on the **former (left) side** return "No usages found"; "the current (right) side navigates as expected"; class types resolve but values, extension functions and constants don't (Kotlin). |
| [IJPL-79824](https://youtrack.jetbrains.com/issue/IJPL-79824) | 0 | Submitted (2021) | Cannot navigate from the left side to a method deleted in the PR; the reporter notes "non-checked out code is not indexed". |
| [IJPL-177327](https://youtrack.jetbrains.com/issue/IJPL-177327) | 6 | Open | Clicking a file in a Timeline comment opens the diff, not the source. |
| [IJPL-74099](https://youtrack.jetbrains.com/issue/IJPL-74099) | 2 | Open | "Jump to Source" from the PR diff went to line 1. A JetBrains reply calls it a bug and links IDEA-329857 (caret position from the combined diff). |
| [IJPL-74150](https://youtrack.jetbrains.com/issue/IJPL-74150) | 15 | Open | Complaints about the all-files ("combined") PR diff: top-aligned files, ordering, loading. Users ask for "one-file-at-a-time". |
| [IJPL-256000](https://youtrack.jetbrains.com/issue/IJPL-256000) | 0 | Submitted (2026-09) | `GotoChangedFile` ("go to changed file by name") does not work in the PR review view (WebStorm 2026.2). |
| [IJPL-101073](https://youtrack.jetbrains.com/issue/IJPL-101073) | 1 | Open | Navigation from a diff does not create an editor history point, so Back does not return to the diff. |
| [IJPL-72978](https://youtrack.jetbrains.com/issue/IJPL-72978) | 35 | Fixed | Navigate between comments in the PR diff (now the `CodeReview.NextComment` / `PreviousComment` actions). |
| [IJPL-72769](https://youtrack.jetbrains.com/issue/IJPL-72769) | 39 | Open | Double-clicking a file opens the diff for all files (listed in the PyCharm note). |

**Reconciling the user's claim with these reports:**

- **"Can't cmd+click in PR review" is not universally true.** It works for symbols that resolve in the local index, as JetBrains showed for Java.
- **It is true in several common cases:**
  - Find Usages from definitions.
  - The left side.
  - Symbols that are new in the PR when the PR is not checked out.
  - Some languages. The reporter used Rust; IJPL-255214 shows Kotlin partly failing.
- **Python is untested.** PyCharm's behaviour in this synthetic-file mode was not tested or found in YouTrack **[unverified]**.

### 2.3 Review Mode (in-editor review, 2024.1)

- **Docs.** "After the successful checkout, IntelliJ IDEA starts the Review mode. That means you can see the highlighted changes and comments not only in the Diff tab (Ctrl+D), but right in the editor (F4)." Pink gutter markers show changes, and clicking one "reveals a popup displaying the original code" ([IDEA docs: Work with GitHub pull requests](https://www.jetbrains.com/help/idea/work-with-github-pull-requests.html)).
- **When the code turns it on:**
  - `GHPRReviewInEditorController` attaches review only to `MAIN_EDITOR` editors with a real `virtualFile` (L114). It does so for the PR returned by `projectVm.prOnCurrentBranch` (L72-77).
  - It shows review UI only when `discussionsViewOption != DONT_SHOW` and `!updateRequired` (L98-103) (`IJ/GH/pullrequest/ui/editor/GHPRReviewInEditorController.kt`).
  - `updateRequired` is true when the PR's `headRefOid` is **not in the current local history** (`IJ/GH/pullrequest/ui/GHPRReviewBranchStateSharedViewModel.kt` L34-37). In that case the UI offers "Update Branch to Enable Review Mode…" (string cited in the PyCharm note §3).
- **Navigation in Review Mode is the full IDE.** It is the normal editor on the real file: Go to Declaration, Find Usages, Recent Files, Back/Forward. The base version is only visible through the gutter popup, so you cannot navigate within the base **[inference]**.
- **Limits [inference from the code above]:**
  - One PR at a time per project window (the PR on the current branch).
  - You must check out and be up to date.
  - Your working tree is switched to the PR branch.

### 2.4 Can more than one PR diff be open at once?

- **The diff tab is a virtual file per PR.** `GHPRDiffVirtualFile` is a `data class` keyed by `(fileManagerId, project, repository, pullRequest)`, named `#<number>.diff` (`IJ/GH/pullrequest/GHPRDiffVirtualFile.kt` L21-40, L69). `GHPRFilesManagerImpl.createAndOpenDiffFile(prId)` opens it with `DiffEditorTabFilesManager.showDiffFile` (`IJ/GH/pullrequest/data/GHPRFilesManagerImpl.kt` L38-47).
  - So **each PR gets one diff tab**, and diff tabs for *different* PRs in the same repository can coexist **[inference from code; not tested in the UI]**.
  - Opening a second file of the *same* PR reuses that tab.
- **Inside the tab** the viewer is either:
  - a one-file-at-a-time `DiffRequestProcessor`; or
  - a **combined diff** of all files stacked, controlled by the advanced setting `enable.combined.diff.for.codereview`, which is disabled on remote-dev hosts (`IJ/GH/pullrequest/ui/diff/GHPRDiffService.kt` L47-55; `IJ/platform/collaboration-tools/src/com/intellij/collaboration/ui/codereview/CodeReviewAdvancedSettings.kt` L13-15).

  There is no supported way to open two files of the same PR as two independent diff tabs side by side. Splitting the editor shows the same PR diff file twice; whether the two halves can show different files was **[unverified]**.
- **Opening the diff in a separate window.** The general diff setting "Show Diff in Separate Window" exists ([IDEA docs: Differences viewer](https://www.jetbrains.com/help/idea/differences-viewer.html)). Whether the PR diff honours it was **[unverified]**.
- **Several PRs fully navigable at the same time:** use **Open in Worktree** (2026.3). It is a separate checkout and project, each with its own index and Review Mode (PyCharm note §3; [IJPL-242111](https://youtrack.jetbrains.com/issue/IJPL-242111)).

### 2.5 Could a plugin add navigation to the PR diff?

- **What `DiffExtension` gives you.** `com.intellij.diff.DiffExtension` gives `onViewerCreated(viewer, context, request)`, described as "Can be used to extend existing DiffViewers without registering new DiffTool" (`IJ/platform/diff-api/src/com/intellij/diff/DiffExtension.java` L28-42). The GitHub plugin itself uses it (`GHPRReviewDiffExtension`).
- **What a plugin could realistically do [inference]:**
  1. **"Navigate in working copy".** Take the caret in the head pane, map it through the diff to the local file (if the PR is checked out and synced), and run Go to Declaration or Find Usages there. This is a cheap, robust improvement on F4: you land in the real editor with full navigation. Effort: days.
  2. **Fix Find Usages from a declaration in the head pane.** Map the declaration to the same element in the local file and search from there. Same mapping. Effort: days to a week. Correct only when local = PR head.
  3. **Navigation on the base side or on a non-checked-out head.** This needs an index of that revision, and the IDE indexes only open projects. Options:
     - create a worktree at the base or head and open it as a second project, then forward navigation requests there (heavyweight; two indexes);
     - consume a SCIP index (§3.3) and implement custom navigation.

     Both are far beyond a diff decoration. **Not realistic** for a small plugin.
- **Stability risk.** `DiffExtension` is public. The GitHub and collaboration-tools classes you would hook into for PR context are mostly `@ApiStatus.Internal` or `@ApiStatus.Experimental` (PyCharm note §5, §8).

---

## 3. A standalone macOS app with real code navigation

### 3.1 The core constraint

Real navigation needs **the whole program at the reviewed revision**, not just the diff hunks.

- **What the LSP expects.** A server is initialized with a workspace (`rootUri`, `workspaceFolders`). After `didOpen`, "the document's content is now managed by the client and the server must not try to read the document's content using the document's Uri". Every other file the server resolves is read from the workspace ([LSP 3.17 spec](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/)).
- **What that means for the app [inference]:** a local checkout at the PR head. A `git worktree` from `git fetch origin pull/ID/head:BRANCH` ([GitHub docs: Checking out pull requests locally](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/checking-out-pull-requests-locally)) is the natural unit. It also lets you review several PRs at once without touching the user's main working tree.
- **Base-side navigation** needs a second worktree at the merge base, with its own server or index.

### 3.2 Options

| Option | What you get | Effort (rough) **[inference]** | Fidelity **[inference]** |
|---|---|---|---|
| **A. Open in the user's IDE** at file:line | Full IDE navigation, in a separate window | Hours | Full, but context-switching. Needs a checkout the IDE has open (or opens). |
| **B. Embedded editor + LSP on a head worktree** | Cmd+click, find references, hover, inside your diff | Weeks for one language; more per extra language and environment handling | High for the head side. Depends on the environment (Python venv, `node_modules`). |
| **C. Precomputed SCIP index per revision** | Definition and references, including cross-repo, served from your own store; fast | Weeks. Indexers need the same environment as B; you serve the queries. | High (compiler-grade indexers), but a snapshot (no edits) |
| **D. tree-sitter tags / ctags** | Name-based "definition candidates" and "references" | Days | Low to medium. Ambiguous names and no type resolution (methods on `self`, overloads, re-exports). |
| **E. GitHub's own code navigation** | Nothing usable | n/a | No API; see below |

**Option A: reuse the user's IDE.**

- **VS Code:**
  - `code --goto file:line[:col]` ("open a file at a specific line and optional character position");
  - `code --diff <file1> <file2>`;
  - URL `vscode://file/{full path to file}:line:column`.

  Source: [VS Code CLI docs](https://code.visualstudio.com/docs/configure/command-line).
- **PyCharm:**
  - `pycharm [--line <number>] [--column <number>] <path>` ([PyCharm: open files from the command line](https://www.jetbrains.com/help/pycharm/opening-files-from-command-line.html));
  - `pycharm.sh diff <path1> <path2>` ([PyCharm: compare files from the command line](https://www.jetbrains.com/help/pycharm/command-line-differences-viewer.html)).
- **Pairing with worktrees.** The app creates the PR worktree and opens it in the IDE. That gives full navigation with no language work, at the cost of leaving the app **[inference]**.

**Option B: embedded editor plus language server.** Both major web editors (hosted in a `WKWebView`) have the pieces.

- **Monaco** (`monaco-editor` 0.57.0 on npm):
  - `editor.createDiffEditor(...)`;
  - `languages.registerDefinitionProvider` / `registerReferenceProvider`;
  - `editor.registerEditorOpener`: "called when a resource other than the current model should be opened in the editor (e.g. "go to definition") … If no handler is registered the default behavior is to do nothing for models other than the currently attached one". This is the hook for cross-file jumps.

  All three are in `monaco-editor@0.57.0/esm/vs/editor/editor.api.d.ts` L980, L1170-1178, L6779, L6819.
  - Monaco's built-in TypeScript worker (`typescriptDefaults`, `addExtraLib`, `setEagerModelSync`, `getTypeScriptWorker`; `monaco.d.ts` L10007-10166) only sees models and extra libs you feed it, not the disk. For a real project use an LSP server instead **[inference]**.
  - **LSP bridge:** `monaco-languageclient` 11.0.2 (TypeFox), "A toolbox for building web applications with editors utilizing language servers". It connects over WebSocket or a Web Worker and has a Pyright example ([repo](https://github.com/TypeFox/monaco-languageclient)).
- **CodeMirror 6:**
  - `@codemirror/merge` 6.12.2 ("A diff/merge view for CodeMirror");
  - `@codemirror/lsp-client` 6.3.0, which "implements a language server protocol (LSP) client for the CodeMirror code editor". The server talks to it through a `Transport` you provide, such as a WebSocket ([README](https://github.com/codemirror/lsp-client/blob/main/README.md); the repo has moved to code.haverbeke.berlin).
  - Which LSP features the client supports (definition, references) was not confirmed from its reference docs **[unverified]**.
- **Native Swift text views** (no web view) would need you to write the LSP client and diff rendering yourself. That is not evaluated here.

**Language servers:**

| | Python (priority) | TypeScript |
|---|---|---|
| Servers | **Pyright** 1.1.414 (the open-source core of Pylance; `pyright-langserver`); **basedpyright** 1.40.2 (fork, "pylance features"); **Pyrefly** 1.3.2 (Meta; "Production/Stable" on PyPI, "type checker and language server"); **ty** 0.0.86 (Astral; Beta; "type checker and language server"); jedi-language-server 0.47.0; python-lsp-server 1.15.0 (versions from npm and PyPI, 2026-10-12) | **TypeScript 7** (native Go port, released 2026-07-08): "The new foundation is built on the Language Server Protocol (LSP)" ([announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)); `typescript` 7.0.2 on npm. **typescript-language-server** 6.0.2 (LSP wrapper around tsserver). |
| **Not usable** | **Pylance**: "licensed for use in Microsoft products and services only, so can only be used on official Microsoft builds of Visual Studio Code and GitHub Codespaces" ([FAQ](https://github.com/microsoft/pylance-release/blob/main/FAQ.md) L17) | — |
| Environment | Third-party imports resolve only if the server can find the project's interpreter or venv. For a PR you may need to create a venv per worktree (`uv sync` or similar), or accept unresolved third-party symbols **[inference]**. | Needs `node_modules` installed in the worktree for library types. Project-internal navigation works from `tsconfig.json` alone **[inference]**. |
| Fidelity **[inference]** | Good for project code; dynamic Python limits any static tool (PyCharm included) | Excellent; it is the compiler |
| Effort **[inference]** | 2–4 weeks: worktree lifecycle, venv handling, server lifecycle, editor wiring, mapping diff panes to URIs | 1–3 weeks; simpler environment story |

**Option C: SCIP indexes.**

- **What SCIP is.** "SCIP … is a language-agnostic protocol for indexing source code, which can be used to power code navigation functionality such as Go to definition, Find references, and Find implementations" ([sourcegraph/scip](https://github.com/sourcegraph/scip)).
- **Indexers** include `scip-python` and `scip-typescript`; both repos were active in October 2026 (GitHub API `pushed_at`).
- **`scip-python`** is a "Sourcegraph fork of pyright", and you should "make sure to activate your virtual environment before running" ([README](https://github.com/sourcegraph/scip-python)). So it has the same environment needs as running Pyright live.
- **The appeal [inference]:**
  - Index base and head once each, for example in CI or a background job.
  - Answer navigation instantly on both sides, including "find usages of a symbol deleted by this PR".
  - No long-running servers.
- **The cost [inference]:**
  - You write the SCIP reader and query layer.
  - Indexes are large.
  - Nothing works for unsaved edits.

**Option D: tree-sitter / ctags.**

- **tree-sitter.** Tags queries mark `@definition.*` and `@reference.*` captures by name; the `tree-sitter tags` CLI runs them ([tree-sitter: Code Navigation](https://tree-sitter.github.io/tree-sitter/4-code-navigation.html)).
- **Universal Ctags.** "ctags generates an index (or tag) file of language objects found in source files" ([docs.ctags.io](https://docs.ctags.io/en/latest/)).
- **How it behaves.** Both are syntax-only, name-matched indexes. That is the same approach GitHub now uses (below). They work on any revision without an environment, so they are fine as a fallback for the base side and for languages without a server **[inference]**.

**Option E: GitHub's code navigation.**

- **What the docs describe today.** GitHub "has developed a code navigation approach based on the open source `tree-sitter` library that searches all definitions and references across a repository to find entities with a given name". It works for 21 listed languages, including Python and TypeScript, and "only works for active branches" and repos with "fewer than 100,000 files" ([GitHub docs: Navigating code on GitHub](https://docs.github.com/en/repositories/working-with-files/using-files/navigating-code-on-github); language list in `data/reusables/search/code-nav-supported-languages.md`).
- **Precise (stack graphs) navigation is gone from the docs.** The docs commit `eac1b74c39` (2024-12-04) is titled "Unship precise code navigation" (history of that file in `github/docs`). Earlier commit `767bff2d14` (2024-03-14) had "Indicate[d] precise code navigation support for TypeScript".
- **`github/stack-graphs` is archived.** "This repository was archived by the owner on Sep 9, 2025", and its README says it "is no longer supported or updated by GitHub" ([repo](https://github.com/github/stack-graphs)).
- **No API.** The code navigation docs mention none, and no REST code-navigation endpoint was found **[unverified as an absence]**.
- **Code search does not cover PR branches.** The nearest API, code search, says "We currently only support searching for code on the default branch of a repository" ([About GitHub code search](https://docs.github.com/en/search-github/github-code-search/about-github-code-search)). PR head branches are not searchable.

### 3.3 Recommendation sketch [inference]

1. **Ship option A first.** Add an "Open in VS Code / PyCharm at this line" action on any diff line. Pair it with an app-managed `git worktree` per PR, so the IDE opens the PR head without disturbing the user's main checkout. This is hours of work and gives full fidelity.
2. **Then option B for the head side.** Use Monaco or CodeMirror in a `WKWebView`, with Pyright or basedpyright for Python (or try ty or Pyrefly for speed) and the TS 7 LSP for TypeScript, on that worktree. Map cmd+click results back into your diff view when the target file is in the PR, and into a plain read-only file view otherwise.
3. **Base-side navigation** ("where was this deleted function called?"): either a second worktree with a second server, or a SCIP index of the merge base. Add it only if reviews of AI-written refactors show the need.

---

## Could not verify

- **Pylance on virtual documents.** Pylance's document selector, and whether Pylance gives *any* navigation on `pr:` or `review:` documents. It is closed source.
- **TypeScript on virtual documents.** The exact TS behaviour on `pr:` or `review:` documents, such as whether go-to-definition reaches other files. This is inference from selectors, not tested.
- **PyCharm in PR diffs.** Behaviour of Python navigation in the PR diff's synthetic files. There are no Python-specific YouTrack reports, and it was not tested.
- **Splitting a PR diff in JetBrains.** Whether splitting a JetBrains PR diff tab, or "Show Diff in Separate Window", lets two files of the same PR show side by side.
- **Two PR diff tabs in JetBrains.** Whether two PRs' diff tabs can be open in one JetBrains project at the same time. The code suggests yes; the UI was not tested.
- **Issue #3631.** Whether vscode-pull-request-github#3631 (stale `pr:` diffs after checkout) fully resolved the problem.
- **Proposed APIs.** The Marketplace rule against proposed APIs (general VS Code policy, not re-read here).
- **CodeMirror lsp-client features.** Its feature list (definition and references support); the reference manual page did not render for me.
- **GitHub code-navigation API.** The absence of any code-navigation API. No endpoint was found; absence cannot be proven from docs.
- **Effort estimates.** All effort and fidelity estimates in §3 are my judgement, not sourced.

## Sources

**VS Code / extension:**

- [VS Code docs: Working with GitHub](https://code.visualstudio.com/docs/sourcecontrol/github)
- [User interface](https://code.visualstudio.com/docs/getstarted/userinterface)
- [Built-in commands](https://code.visualstudio.com/api/references/commands)
- [Command line](https://code.visualstudio.com/docs/configure/command-line)
- `microsoft/vscode-pull-request-github` @ `596015ab3d`:
  - `package.json`, `package.nls.json`, `CHANGELOG.md`
  - `src/common/uri.ts`, `src/view/fileChangeModel.ts`, `src/view/reviewManager.ts`, `src/view/treeNodes/{fileChangeNode,pullRequestNode,filesCategoryNode,repositoryChangesNode}.ts`
  - `src/github/pullRequestModel.ts`, `src/github/worktree.ts`, `src/commands.ts`, `webviews/components/timeline.tsx`
- Issues [#486](https://github.com/microsoft/vscode-pull-request-github/issues/486), [#2232](https://github.com/microsoft/vscode-pull-request-github/issues/2232), [#3631](https://github.com/microsoft/vscode-pull-request-github/issues/3631)
- `microsoft/vscode` @ `acf9515dc1`:
  - `extensions/typescript-language-features/src/{configuration/fileSchemes.ts,languageProvider.ts,languageFeatures/definitions.ts,languageFeatures/references.ts}`
  - `src/vscode-dts/vscode.d.ts`
- `microsoft/pyright` @ `79cd772619`: `packages/vscode-pyright/src/extension.ts`; `docs/installation.md`
- [pylance-release FAQ](https://github.com/microsoft/pylance-release/blob/main/FAQ.md)

**JetBrains:**

- [IDEA: Work with GitHub pull requests](https://www.jetbrains.com/help/idea/work-with-github-pull-requests.html)
- [Differences viewer](https://www.jetbrains.com/help/idea/differences-viewer.html)
- [PyCharm: open files from the command line](https://www.jetbrains.com/help/pycharm/opening-files-from-command-line.html)
- [PyCharm: diff from the command line](https://www.jetbrains.com/help/pycharm/command-line-differences-viewer.html)
- `JetBrains/intellij-community` @ `5f40c823bf`:
  - `plugins/github/github-core/src/org/jetbrains/plugins/github/pullrequest/{GHPRDiffVirtualFile.kt,data/GHPRFilesManagerImpl.kt,ui/GHPRReviewBranchStateSharedViewModel.kt,ui/diff/GHPRDiffService.kt,ui/diff/GHPRDiffChangeViewModel.kt,ui/editor/GHPRReviewInEditorController.kt}`
  - `plugins/git4idea/backend/src/changes/GitBranchComparisonResult.kt`
  - `platform/diff-impl/src/com/intellij/diff/DiffContentFactoryImpl.java`
  - `platform/diff-api/src/com/intellij/diff/DiffExtension.java`
  - `platform/analysis-impl/src/com/intellij/codeInsight/daemon/SyntheticPsiFileSupport.java`
  - `platform/collaboration-tools/src/com/intellij/collaboration/ui/codereview/CodeReviewAdvancedSettings.kt`
- YouTrack: IJPL-242806, IJPL-100530, IJPL-255214, IJPL-79824, IJPL-177327, IJPL-74099, IJPL-74150, IJPL-256000, IJPL-101073, IJPL-72978, IJPL-72769, IJPL-242111 (at `https://youtrack.jetbrains.com/issue/<ID>`)

**Editors, language servers, indexes:**

- [LSP 3.17 specification](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/)
- `monaco-editor@0.57.0` typings (`esm/vs/editor/editor.api.d.ts`, `monaco.d.ts` via unpkg)
- [TypeFox/monaco-languageclient](https://github.com/TypeFox/monaco-languageclient)
- [@codemirror/lsp-client README](https://github.com/codemirror/lsp-client/blob/main/README.md); npm registry for `@codemirror/merge`, `@codemirror/lsp-client`, `pyright`, `basedpyright`, `typescript`, `typescript-language-server`
- PyPI for `ty`, `pyrefly`, `jedi-language-server`, `python-lsp-server`
- [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
- [sourcegraph/scip](https://github.com/sourcegraph/scip); [sourcegraph/scip-python](https://github.com/sourcegraph/scip-python)
- [tree-sitter: Code Navigation](https://tree-sitter.github.io/tree-sitter/4-code-navigation.html)
- [Universal Ctags docs](https://docs.ctags.io/en/latest/)

**GitHub:**

- [Navigating code on GitHub](https://docs.github.com/en/repositories/working-with-files/using-files/navigating-code-on-github) (+ `github/docs` commit history: `eac1b74c39`, `767bff2d14`)
- [About GitHub code search](https://docs.github.com/en/search-github/github-code-search/about-github-code-search)
- [Checking out pull requests locally](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/checking-out-pull-requests-locally)
- [github/stack-graphs](https://github.com/github/stack-graphs) (archived)
