# Changelog

## [0.10.0](https://github.com/edziegle/dear_reviewer/compare/v0.9.0...v0.10.0) (2026-10-23)


### Features

* act on a Finding from Quick Fix, and mark it with the Assistant's cat ([#205](https://github.com/edziegle/dear_reviewer/issues/205)) ([2c2fabf](https://github.com/edziegle/dear_reviewer/commit/2c2fabf5845e8f530958058007419d1ed88b8815))
* **assistant:** show why a quoted Claude Command item can't run ([#202](https://github.com/edziegle/dear_reviewer/issues/202)) ([f47d74a](https://github.com/edziegle/dear_reviewer/commit/f47d74a236c39dba2fc2580855cdf6b82bcffd53))
* **findings:** ask the Assistant about a Finding from its hover ([#215](https://github.com/edziegle/dear_reviewer/issues/215)) ([35b0609](https://github.com/edziegle/dear_reviewer/commit/35b06092a10ceda22c6eef6da1e1bd51fc553adb))
* **findings:** head a Finding's hover with the Assistant's cat and name, and wrap its message between words ([#216](https://github.com/edziegle/dear_reviewer/issues/216)) ([353f8e5](https://github.com/edziegle/dear_reviewer/commit/353f8e507b0714370ebed987a585a224557fe177))
* **findings:** open a Finding's hover when stepping to it, and step from the hover ([#204](https://github.com/edziegle/dear_reviewer/issues/204)) ([f1df17a](https://github.com/edziegle/dear_reviewer/commit/f1df17a7d1476f1df09431651ce8b1c8e454c854))
* **findings:** show the Findings view as a webview, with the current Finding open and a stepper at its foot ([#211](https://github.com/edziegle/dear_reviewer/issues/211)) ([93a5a9b](https://github.com/edziegle/dear_reviewer/commit/93a5a9b781efdabe8c25125cfd1b430dc3f9dbf1))
* **repetition:** say what the Reviewer should check at a Repeated edit ([#209](https://github.com/edziegle/dear_reviewer/issues/209)) ([70253c6](https://github.com/edziegle/dear_reviewer/commit/70253c6acf7a2dfe532f5ac459f0e03705b1236e))


### Bug Fixes

* **repetition:** count a Repeated edit only when most of its sites made the same change as written ([#208](https://github.com/edziegle/dear_reviewer/issues/208)) ([26064ca](https://github.com/edziegle/dear_reviewer/commit/26064cabb94388e6edb6443298611c4fd22238e5))

## [0.9.0](https://github.com/edziegle/dear_reviewer/compare/v0.8.1...v0.9.0) (2026-10-23)


### Features

* **assistant:** start claude through the Reviewer's own command ([#195](https://github.com/edziegle/dear_reviewer/issues/195)) ([4d3e1d5](https://github.com/edziegle/dear_reviewer/commit/4d3e1d52b8249b16661386b9a9260acbc0043b9b))


### Bug Fixes

* **assistant:** disable all hooks in the Assistant's claude ([#191](https://github.com/edziegle/dear_reviewer/issues/191)) ([2129c09](https://github.com/edziegle/dear_reviewer/commit/2129c095cfa8d9a48c5eeb6b90428949f53e4244)), closes [#184](https://github.com/edziegle/dear_reviewer/issues/184)
* **dashboard:** share the overview's review-verdict colors ([#190](https://github.com/edziegle/dear_reviewer/issues/190)) ([db5531c](https://github.com/edziegle/dear_reviewer/commit/db5531c8bb50666d88eadcc95320a01e7078d58e))
* **diff:** keep Open All Diffs beside the overview when it takes the focus back ([#196](https://github.com/edziegle/dear_reviewer/issues/196)) ([2b6f021](https://github.com/edziegle/dear_reviewer/commit/2b6f021344f1e28395ab8be8cbf91a5be7065217))
* **ui:** give every avatar a hairline edge in every theme ([#193](https://github.com/edziegle/dear_reviewer/issues/193)) ([382ef31](https://github.com/edziegle/dear_reviewer/commit/382ef31d688a876007a067fa40f44a067ade8c9c)), closes [#183](https://github.com/edziegle/dear_reviewer/issues/183)

## [0.8.1](https://github.com/edziegle/dear_reviewer/compare/v0.8.0...v0.8.1) (2026-10-22)

### Bug Fixes

- **code-flow:** make the Code Flow readable in every theme, and let the picture lead ([#174](https://github.com/edziegle/dear_reviewer/issues/174)) ([ea1820f](https://github.com/edziegle/dear_reviewer/commit/ea1820ff13fee727c4c34625e49008c321280b6d))
- **dashboard:** announce Ignore and Restore to screen readers ([#187](https://github.com/edziegle/dear_reviewer/issues/187)) ([5bc4415](https://github.com/edziegle/dear_reviewer/commit/5bc44157d22495a8f3b0f24f22e96c6398f40a62)), closes [#180](https://github.com/edziegle/dear_reviewer/issues/180)
- **dashboard:** keep a reviewed pull request out of Waiting on you ([#189](https://github.com/edziegle/dear_reviewer/issues/189)) ([bf4057f](https://github.com/edziegle/dear_reviewer/commit/bf4057f5f9fb4112fab942e764bbd8f10ff02b6d))
- **dashboard:** protect a Waiting on you row's wait duration from truncation ([#185](https://github.com/edziegle/dear_reviewer/issues/185)) ([6a139c9](https://github.com/edziegle/dear_reviewer/commit/6a139c9ff315952e884c2d5ded9c01626d4d440b)), closes [#181](https://github.com/edziegle/dear_reviewer/issues/181)
- open the diff from the overview's Start at line and take links ([#188](https://github.com/edziegle/dear_reviewer/issues/188)) ([1686933](https://github.com/edziegle/dear_reviewer/commit/1686933a22a1335ad3b1ba4acaeced0844ad4697))

## [0.8.0](https://github.com/edziegle/dear_reviewer/compare/v0.7.0...v0.8.0) (2026-10-21)

### Features

- **code-flow:** have the Assistant walk through a Change's Code Flow in order ([#155](https://github.com/edziegle/dear_reviewer/issues/155)) ([61374ae](https://github.com/edziegle/dear_reviewer/commit/61374aee2ca9bb38ab759b59dc9b077aca948efa)), closes [#72](https://github.com/edziegle/dear_reviewer/issues/72)
- **code-flow:** move the call map's symbols to their new places, and run ink along a selected symbol's calls ([#159](https://github.com/edziegle/dear_reviewer/issues/159)) ([fbc7eda](https://github.com/edziegle/dear_reviewer/commit/fbc7eda44a53b650be218c3e90280d99723fdfb1))
- **comments:** let the Assistant add an Agent note under a pending pull request Comment ([#169](https://github.com/edziegle/dear_reviewer/issues/169)) ([137553c](https://github.com/edziegle/dear_reviewer/commit/137553c3d31973988f47e47049364bca1babd9d5))
- **reading-order:** mark lock files, generated files and exact renames skim-only, and label the core ([#157](https://github.com/edziegle/dear_reviewer/issues/157)) ([52075b6](https://github.com/edziegle/dear_reviewer/commit/52075b6af86d75d092723f0a658eb91b3f66d933)), closes [#115](https://github.com/edziegle/dear_reviewer/issues/115)
- **repetition:** tell the Reviewer when a Change repeats an edit, and give Duplicate code candidates to the Assistant ([#172](https://github.com/edziegle/dear_reviewer/issues/172)) ([2474c20](https://github.com/edziegle/dear_reviewer/commit/2474c202a24bda897e11a1567d9a4fee8642d694))
- **skim-only:** mark a file skim-only when its change is formatting only, by comparing syntax trees ([#173](https://github.com/edziegle/dear_reviewer/issues/173)) ([5e1ab08](https://github.com/edziegle/dear_reviewer/commit/5e1ab088dd9ea984a242c4993dee4e39caf948bf))

### Bug Fixes

- **assistant:** show text the Reviewer can't see as escapes, and drop HTML comments, before it reaches a prompt ([#170](https://github.com/edziegle/dear_reviewer/issues/170)) ([1daef7d](https://github.com/edziegle/dear_reviewer/commit/1daef7dc27d1a652a86ff2d96ea7708ff2718d34)), closes [#163](https://github.com/edziegle/dear_reviewer/issues/163)
- **change-files:** act on the Change of whichever row has focus when a title-bar button is clicked ([#171](https://github.com/edziegle/dear_reviewer/issues/171)) ([ff06ec2](https://github.com/edziegle/dear_reviewer/commit/ff06ec2fbdd9c16c3f01eadac96d9a94d5ce4169)), closes [#138](https://github.com/edziegle/dear_reviewer/issues/138)
- **listing:** ship the changelog, and give the listings a banner, a Q&A link and matching categories ([#167](https://github.com/edziegle/dear_reviewer/issues/167)) ([e02cf5d](https://github.com/edziegle/dear_reviewer/commit/e02cf5d29c803fff374930cd49d741d3994a6e73))

## [0.7.0](https://github.com/edziegle/dear_reviewer/compare/v0.6.0...v0.7.0) (2026-10-20)

### Features

- **overview:** add a View on GitHub button and command for a pull request ([#150](https://github.com/edziegle/dear_reviewer/issues/150)) ([b2924cb](https://github.com/edziegle/dear_reviewer/commit/b2924cb2e3547500db9d42a9caff289dd4703df7))

### Bug Fixes

- **walkthrough:** redraw the walkthrough's images at 2x, with a task that does it ([#152](https://github.com/edziegle/dear_reviewer/issues/152)) ([f4452bf](https://github.com/edziegle/dear_reviewer/commit/f4452bff1e40cae4e896fc76cac89c1158b6194f)), closes [#74](https://github.com/edziegle/dear_reviewer/issues/74)

## [0.6.0](https://github.com/edziegle/dear_reviewer/compare/v0.5.0...v0.6.0) (2026-10-20)

### Features

- **code-flow:** give the call map and swimlanes a keyboard and screen reader model ([#136](https://github.com/edziegle/dear_reviewer/issues/136)) ([0461967](https://github.com/edziegle/dear_reviewer/commit/0461967814339139e20ad5a42998c12444cb268f)), closes [#121](https://github.com/edziegle/dear_reviewer/issues/121)
- **code-flow:** lead with the symbols that make calls ([#139](https://github.com/edziegle/dear_reviewer/issues/139)) ([309800c](https://github.com/edziegle/dear_reviewer/commit/309800c6d245b47f4f6e51dca2471a84bdbf9900))
- **release:** list every release on Open VSX ([#146](https://github.com/edziegle/dear_reviewer/issues/146)) ([ef02f35](https://github.com/edziegle/dear_reviewer/commit/ef02f35d0ec4c1c15e44ee0488a82ed25c6ed3d6))
- **review-window:** name the Change under review by its pull request's title ([#132](https://github.com/edziegle/dear_reviewer/issues/132)) ([cf5ab89](https://github.com/edziegle/dear_reviewer/commit/cf5ab89188dbbd47f4fb3b3d37c3fb5f7ece2ffd))

### Bug Fixes

- **assistant:** confine the Assistant's reads to the Change and fence all other people's text ([#144](https://github.com/edziegle/dear_reviewer/issues/144)) ([0d7055d](https://github.com/edziegle/dear_reviewer/commit/0d7055dc9d99fabdfb18084d1958cc0a66594d32)), closes [#112](https://github.com/edziegle/dear_reviewer/issues/112)
- **code-flow:** list only the swimlane entries that make calls ([#140](https://github.com/edziegle/dear_reviewer/issues/140)) ([c56bb6a](https://github.com/edziegle/dear_reviewer/commit/c56bb6a9838c364f46c5be77f7d3ff416b3e59c1)), closes [#113](https://github.com/edziegle/dear_reviewer/issues/113)
- **code-flow:** offer each control and notice only in the view it acts on ([#133](https://github.com/edziegle/dear_reviewer/issues/133)) ([d630d84](https://github.com/edziegle/dear_reviewer/commit/d630d845d3e1451dc97230306368c62b75694b04)), closes [#122](https://github.com/edziegle/dear_reviewer/issues/122)
- **overview:** offer Submit Another Review… and rename Close Change ([#137](https://github.com/edziegle/dear_reviewer/issues/137)) ([d805443](https://github.com/edziegle/dear_reviewer/commit/d805443912a5967686c06a6e6d5be822aaaf7907)), closes [#76](https://github.com/edziegle/dear_reviewer/issues/76)
- **webviews:** give code in rendered Markdown the theme's foreground ([#145](https://github.com/edziegle/dear_reviewer/issues/145)) ([b7f2bf8](https://github.com/edziegle/dear_reviewer/commit/b7f2bf81e5e9ec1e6180a4442079bee22f94d6c0)), closes [#89](https://github.com/edziegle/dear_reviewer/issues/89)

## [0.5.0](https://github.com/edziegle/dear_reviewer/compare/v0.4.0...v0.5.0) (2026-10-19)

### Features

- **assistant:** give the Assistant a plain tone in Simplified Technical English ([0d5a441](https://github.com/edziegle/dear_reviewer/commit/0d5a441e9cfdc4a789c61a3b4afd0a492c0f96e4))
- **code-flow:** hide test code unless the Reviewer shows it ([#118](https://github.com/edziegle/dear_reviewer/issues/118)) ([f8e077e](https://github.com/edziegle/dear_reviewer/commit/f8e077e94ce9556b5ab981ebbc89fb478707df8d))
- **dashboard:** reload the Inbox when another window closes a Change ([#94](https://github.com/edziegle/dear_reviewer/issues/94)) ([7ec2ea0](https://github.com/edziegle/dear_reviewer/commit/7ec2ea00d613d5775027dcd4938d4aaebe5e3b8d)), closes [#79](https://github.com/edziegle/dear_reviewer/issues/79)
- **review-window:** hold one Active Change, in the review window ([#111](https://github.com/edziegle/dear_reviewer/issues/111)) ([72b2329](https://github.com/edziegle/dear_reviewer/commit/72b2329812876166ccfec9effd818a53fe4022cf))

### Bug Fixes

- **assistant:** keep the Assistant's view in every window and offer Open Assistant when empty ([#110](https://github.com/edziegle/dear_reviewer/issues/110)) ([eaa1c1c](https://github.com/edziegle/dear_reviewer/commit/eaa1c1c6e113ab8be725efa4924e4720025cd76a))
- **code-flow:** fit a call map symbol's name beside its status label ([#123](https://github.com/edziegle/dear_reviewer/issues/123)) ([2f9c3e8](https://github.com/edziegle/dear_reviewer/commit/2f9c3e86a9e182b4da64f31e6558f6c00723acaf)), closes [#91](https://github.com/edziegle/dear_reviewer/issues/91)
- **code-flow:** keep the canvas scrolled where it was when the Reviewer selects a symbol ([#129](https://github.com/edziegle/dear_reviewer/issues/129)) ([0a50854](https://github.com/edziegle/dear_reviewer/commit/0a50854dd6bef86ef18ec172529e3401c85a858b))
- **code-flow:** mark a Swimlanes call with its status and location ([#130](https://github.com/edziegle/dear_reviewer/issues/130)) ([befc71b](https://github.com/edziegle/dear_reviewer/commit/befc71b680f46d5b32a807cd8442e6f8fdb3a846))
- **code-flow:** tell a language server with no call hierarchy from one that timed out ([#125](https://github.com/edziegle/dear_reviewer/issues/125)) ([c32f40a](https://github.com/edziegle/dear_reviewer/commit/c32f40a09866c3cf26f4966b36421f2c01bddd8f)), closes [#90](https://github.com/edziegle/dear_reviewer/issues/90)
- **refresh:** keep a Change's place when a swap brings its new head ([#103](https://github.com/edziegle/dear_reviewer/issues/103)) ([20a9e68](https://github.com/edziegle/dear_reviewer/commit/20a9e685230485912292878090adb7b157f2cbd7)), closes [#101](https://github.com/edziegle/dear_reviewer/issues/101)
- **refresh:** reopen the file beside the overview, wherever the focus is ([#131](https://github.com/edziegle/dear_reviewer/issues/131)) ([55ff76c](https://github.com/edziegle/dear_reviewer/commit/55ff76c0ede25c9e26ba7f4383eedc32a47d3790))
- **review-window:** close the review window when the Reviewer closes its last Change ([#99](https://github.com/edziegle/dear_reviewer/issues/99)) ([a1ca6e1](https://github.com/edziegle/dear_reviewer/commit/a1ca6e14d66356de8e33c7a34d3c7023c74d288c)), closes [#77](https://github.com/edziegle/dear_reviewer/issues/77)

## [0.4.0](https://github.com/edziegle/dear_reviewer/compare/v0.3.0...v0.4.0) (2026-10-17)

### Features

- **assistant:** show the Assistant in the Secondary Side Bar ([ce18724](https://github.com/edziegle/dear_reviewer/commit/ce187248a78b4d4f00aed2fd6ceb12201e165fbd)), closes [#84](https://github.com/edziegle/dear_reviewer/issues/84)
- **code-flow:** add code flow view ([95b8f45](https://github.com/edziegle/dear_reviewer/commit/95b8f452a45f5ee969969b1b78fd81e5cdcb0930))
- keep a team-requested pull request in the Inbox once a teammate reviews it ([1b7f9d7](https://github.com/edziegle/dear_reviewer/commit/1b7f9d70a72e484b40b7c7a6b89119db6dc8f33c)), closes [#54](https://github.com/edziegle/dear_reviewer/issues/54)
- let the Reviewer ignore a pull request waiting on them ([8e72878](https://github.com/edziegle/dear_reviewer/commit/8e728780ca26eedf8917054623c3d78ba08fe713)), closes [#70](https://github.com/edziegle/dear_reviewer/issues/70)
- **overview:** give the Change overview a masthead ([fdd5501](https://github.com/edziegle/dear_reviewer/commit/fdd5501e678700735338072a14c41dcf70e69ee7)), closes [#37](https://github.com/edziegle/dear_reviewer/issues/37)
- refresh a pull request's Change when the window regains focus ([624ab60](https://github.com/edziegle/dear_reviewer/commit/624ab607e59d15584618c744e8efda1b48aed71a)), closes [#75](https://github.com/edziegle/dear_reviewer/issues/75)

### Bug Fixes

- keep a Comment being written when new commits arrive, and check what GitHub gives git ([c1a6fa0](https://github.com/edziegle/dear_reviewer/commit/c1a6fa0d1be1da760bc23511e39cb240c37233c2)), closes [#75](https://github.com/edziegle/dear_reviewer/issues/75)
- let go of a Change's state when another window closes it ([b4e0536](https://github.com/edziegle/dear_reviewer/commit/b4e053634685a617ab4a8c67537ca6179ac0c825)), closes [#56](https://github.com/edziegle/dear_reviewer/issues/56)
- **refresh:** run a focus check that met a running one when it ends ([93f09cc](https://github.com/edziegle/dear_reviewer/commit/93f09cc57c53b5c221a6880f6e008c66411b0732)), closes [#87](https://github.com/edziegle/dear_reviewer/issues/87)
- **refresh:** run the owed check whatever the gap ([c9e6b4c](https://github.com/edziegle/dear_reviewer/commit/c9e6b4cd4f705d38b2de56b65cb1289cbb1f2238)), closes [#87](https://github.com/edziegle/dear_reviewer/issues/87)
- start Change Files tall and Findings small in a fresh layout ([bdea6da](https://github.com/edziegle/dear_reviewer/commit/bdea6daa868fd9e76db4b36646cfb56ad92f90d0)), closes [#80](https://github.com/edziegle/dear_reviewer/issues/80)
- time out GitHub requests that never answer ([7520ef4](https://github.com/edziegle/dear_reviewer/commit/7520ef458c4cc8196ab7cf31cb9af2ff91d7b6e4)), closes [#65](https://github.com/edziegle/dear_reviewer/issues/65)

## [0.3.0](https://github.com/edziegle/dear_reviewer/compare/v0.2.1...v0.3.0) (2026-10-16)

### Features

- lay out In progress like Waiting on you ([cd8dbbe](https://github.com/edziegle/dear_reviewer/commit/cd8dbbe1550bab38994c7c180af5d26e18f159c2)), closes [#38](https://github.com/edziegle/dear_reviewer/issues/38)
- lead In progress with the Change shown last, and keep its rows light ([ab43cb3](https://github.com/edziegle/dear_reviewer/commit/ab43cb383959642394abe12f5a4edefba5439011)), closes [#38](https://github.com/edziegle/dear_reviewer/issues/38)
- make the Dashboard the side bar outside the review window ([a0f9dec](https://github.com/edziegle/dear_reviewer/commit/a0f9decd86e181b984d86d55bf5e0647a1bbf316)), closes [#38](https://github.com/edziegle/dear_reviewer/issues/38)
- show each pull request once, in progress or waiting ([b1c065d](https://github.com/edziegle/dear_reviewer/commit/b1c065d1bdb47b68889faa43113ce7827bb65151)), closes [#38](https://github.com/edziegle/dear_reviewer/issues/38)
- show loading with the editor's progress bar ([4d8c072](https://github.com/edziegle/dear_reviewer/commit/4d8c0726527b9075ac7fd1dc338e1b02998358af)), closes [#38](https://github.com/edziegle/dear_reviewer/issues/38)

### Bug Fixes

- keep the open-Changes list safe when several windows write it ([3ec50c4](https://github.com/edziegle/dear_reviewer/commit/3ec50c4c10d1616f44a5fe90e2816355ac6906e2)), closes [#55](https://github.com/edziegle/dear_reviewer/issues/55)

## [0.2.1](https://github.com/edziegle/dear_reviewer/compare/v0.2.0...v0.2.1) (2026-10-15)

### Bug Fixes

- keep the focus clear of Home's header and name each row's buttons ([#62](https://github.com/edziegle/dear_reviewer/issues/62)) ([fb0e4c3](https://github.com/edziegle/dear_reviewer/commit/fb0e4c3b376ed624c5e95d5491ff5d7aa2518563))

## [0.2.0](https://github.com/edziegle/dear_reviewer/compare/v0.1.1...v0.2.0) (2026-10-15)

### Features

- draw the Change's viewed progress as a bar, and show its overview from Change Files ([1690428](https://github.com/edziegle/dear_reviewer/commit/1690428bfdd727401851c983a8b8da8eea265b86)), closes [#49](https://github.com/edziegle/dear_reviewer/issues/49)
- give the Assistant read-only git history through its own MCP server ([9f55d40](https://github.com/edziegle/dear_reviewer/commit/9f55d40d38fe5bb237eb37d59546b6c1bdcff81f)), closes [#39](https://github.com/edziegle/dear_reviewer/issues/39)
- mark a long Finding with one lightbulb and a bar down its lines ([34246ca](https://github.com/edziegle/dear_reviewer/commit/34246ca54707d22fe9cc3a960fd102cca5ea2a5c)), closes [#40](https://github.com/edziegle/dear_reviewer/issues/40)
- show whether my own pull requests need me or are ready to merge ([1cdb32d](https://github.com/edziegle/dear_reviewer/commit/1cdb32da0e925206db1a56a358c2f08f3f9e16d3)), closes [#51](https://github.com/edziegle/dear_reviewer/issues/51)

### Bug Fixes

- check git's version again after a failed check ([c8b0cc5](https://github.com/edziegle/dear_reviewer/commit/c8b0cc5d51de8e204bcb52264c6b23d9d78d4d51)), closes [#39](https://github.com/edziegle/dear_reviewer/issues/39)
- close several Changes in one write, and wait only for folders on their way ([0c5ee87](https://github.com/edziegle/dear_reviewer/commit/0c5ee875f558110bcc46da09f6ed0d306cab86a0)), closes [#35](https://github.com/edziegle/dear_reviewer/issues/35)
- follow the open Changes another window changes in the review window ([e386cf6](https://github.com/edziegle/dear_reviewer/commit/e386cf6ec307bb39521554de6ad6407fd8421f60)), closes [#35](https://github.com/edziegle/dear_reviewer/issues/35)
- judge my pull requests by reviewers' latest opinions, and recheck mergeability ([31f8675](https://github.com/edziegle/dear_reviewer/commit/31f8675fc8d65020147880d6a72a91a83c437de5)), closes [#51](https://github.com/edziegle/dear_reviewer/issues/51)
- keep a Change opened earlier behind one shown, when its folders arrive later ([#60](https://github.com/edziegle/dear_reviewer/issues/60)) ([3afad3b](https://github.com/edziegle/dear_reviewer/commit/3afad3b183649e9a444cdc8b30880bc559c4116b)), closes [#35](https://github.com/edziegle/dear_reviewer/issues/35)
- keep the git tools from fetching, and from telling of refs outside the Change ([2df9882](https://github.com/edziegle/dear_reviewer/commit/2df98824455a11f58efa18a0e7b44dd5ab1eedcf)), closes [#39](https://github.com/edziegle/dear_reviewer/issues/39)
- leave out a reviewer whose latest opinion was dismissed ([b9404d3](https://github.com/edziegle/dear_reviewer/commit/b9404d3910e56d284d8663b92c340a3fcaa2c85c)), closes [#51](https://github.com/edziegle/dear_reviewer/issues/51)
- list only the Change in front in Change Files and Findings ([f9ad59d](https://github.com/edziegle/dear_reviewer/commit/f9ad59d93981c07e49dbb6eff0e2062beb5321fe)), closes [#35](https://github.com/edziegle/dear_reviewer/issues/35)
- need git 2.44 for the git tools, and follow only real parents ([2a8e8b6](https://github.com/edziegle/dear_reviewer/commit/2a8e8b6c7445cddedd0657aeee11e3050986f616)), closes [#39](https://github.com/edziegle/dear_reviewer/issues/39)
- say no Change is in front, rather than open, when a command finds none ([85905f0](https://github.com/edziegle/dear_reviewer/commit/85905f0b9f9cb02147095e7547c080bd9284a865)), closes [#35](https://github.com/edziegle/dear_reviewer/issues/35)
- show the Change now in front once the one in front closes ([5b4f693](https://github.com/edziegle/dear_reviewer/commit/5b4f6938e2ad1000956777e4a0ae2384ce6d4c84)), closes [#35](https://github.com/edziegle/dear_reviewer/issues/35)
- wait for the open Changes to settle before showing the one in front ([5b34108](https://github.com/edziegle/dear_reviewer/commit/5b34108271be65ace6d7168e773bfb9558da392e)), closes [#35](https://github.com/edziegle/dear_reviewer/issues/35)

### Performance Improvements

- work out a Finding's gutter icons by span, not line by line ([4a8ba64](https://github.com/edziegle/dear_reviewer/commit/4a8ba64694fb8858649b13fb2ce646c79a51c75f)), closes [#40](https://github.com/edziegle/dear_reviewer/issues/40)

## [0.1.1](https://github.com/edziegle/dear_reviewer/compare/v0.1.0...v0.1.1) (2026-10-15)

### Bug Fixes

- let tests wait for the Inbox's refreshes ([0c4ec8b](https://github.com/edziegle/dear_reviewer/commit/0c4ec8b673abc6f94566405004bb06498b42ac87)), closes [#45](https://github.com/edziegle/dear_reviewer/issues/45)
- never publish a reply the Reviewer expects to wait for the Review ([a7fd78a](https://github.com/edziegle/dear_reviewer/commit/a7fd78acbcbfa01b356825b3b3ba8d364f589593)), closes [#31](https://github.com/edziegle/dear_reviewer/issues/31)

## [0.1.0](https://github.com/edziegle/dear_reviewer/compare/v0.0.1...v0.1.0) (2026-10-15)

### Features

- add a Reviewed by me group to the Inbox ([c42db09](https://github.com/edziegle/dear_reviewer/commit/c42db091e4a6526e283f16a7afcb732a32657629)), closes [#21](https://github.com/edziegle/dear_reviewer/issues/21)
- add follow-up Comments to the Reviewer's own pending threads ([52f18aa](https://github.com/edziegle/dear_reviewer/commit/52f18aaf4b0dbba3b7e9b7472deff06d2dac6f27)), closes [#31](https://github.com/edziegle/dear_reviewer/issues/31)
- ask the Assistant about the file you're reading from its title bar ([bc207c9](https://github.com/edziegle/dear_reviewer/commit/bc207c9d815fae341ec91d1edccb7cb715fbb486)), closes [#24](https://github.com/edziegle/dear_reviewer/issues/24)
- give the Assistant the Change's commits and its pull request's description ([572298a](https://github.com/edziegle/dear_reviewer/commit/572298af78bb7f28f08c0a9a6fc3bd94b03bb3a2)), closes [#27](https://github.com/edziegle/dear_reviewer/issues/27)
- label a new thread's button Start Review or Add Review Comment ([676d0ae](https://github.com/edziegle/dear_reviewer/commit/676d0ae14982d3777190fcdd1c07b2f5ed3ff56b)), closes [#30](https://github.com/edziegle/dear_reviewer/issues/30)
- let the Assistant read the Change's review threads and know where the Reviewer is reading ([05d464b](https://github.com/edziegle/dear_reviewer/commit/05d464b6cbc89014388ae135f21d9210221e0385)), closes [#26](https://github.com/edziegle/dear_reviewer/issues/26)
- mark a Change's file viewed from its title bar and tab menu ([d6d89b7](https://github.com/edziegle/dear_reviewer/commit/d6d89b7579fe124aa4091f6d3b869f4c9582a1d9)), closes [#32](https://github.com/edziegle/dear_reviewer/issues/32)
- name the Assistant's tab after its Change, not its commits ([6c4aaf9](https://github.com/edziegle/dear_reviewer/commit/6c4aaf92a6af3bd34b61dc546d2408ecbb41bd40)), closes [#28](https://github.com/edziegle/dear_reviewer/issues/28)
- offer Show Overview and Finish Review where the Reviewer finishes ([21c8309](https://github.com/edziegle/dear_reviewer/commit/21c8309c68f4228298a69d36867fa882e7ba2e09)), closes [#33](https://github.com/edziegle/dear_reviewer/issues/33)
- offer to find a language extension for unhighlighted files ([db7cd9e](https://github.com/edziegle/dear_reviewer/commit/db7cd9e14b0de23da843ba6ba948112d82d4ff1c)), closes [#29](https://github.com/edziegle/dear_reviewer/issues/29)
- open added and deleted files in a plain editor ([96cf6c5](https://github.com/edziegle/dear_reviewer/commit/96cf6c5b25b960700ed367629421be81f36991dc)), closes [#25](https://github.com/edziegle/dear_reviewer/issues/25)
- show a submitted Review's verdict and move it out of Awaiting my review ([212e1ba](https://github.com/edziegle/dear_reviewer/commit/212e1ba796af287b2c7ef0e8ebeb0cf7636dcf38)), closes [#34](https://github.com/edziegle/dear_reviewer/issues/34)
- show the Dear Reviewer logo and a short state in the Assistant's status bar item ([fe15786](https://github.com/edziegle/dear_reviewer/commit/fe15786d7b1cbfe34cdf8618dffd785aac9b4c3e)), closes [#22](https://github.com/edziegle/dear_reviewer/issues/22)
- suggest a Reading Order with the summary (ADR 0022) ([87c9224](https://github.com/edziegle/dear_reviewer/commit/87c922462f1421f5ed1d2aecb39b2a224832febe)), closes [#23](https://github.com/edziegle/dear_reviewer/issues/23)

### Bug Fixes

- act on no Change from a file whose Change isn't open in the window ([dcca3c6](https://github.com/edziegle/dear_reviewer/commit/dcca3c6c70247ebf3b0a92b8befdf7f0f6b0f66b)), closes [#33](https://github.com/edziegle/dear_reviewer/issues/33)
- mark viewed only the files a Change changes, from a tab or title bar ([6a01d8b](https://github.com/edziegle/dear_reviewer/commit/6a01d8b6ca5a89234ff55e24ec8e9b421490698d)), closes [#32](https://github.com/edziegle/dear_reviewer/issues/32)
- step to the next unviewed file from the overview's code column ([7c31c76](https://github.com/edziegle/dear_reviewer/commit/7c31c769cbd847e6fe787cb5d1d68f8b7353cc95)), closes [#36](https://github.com/edziegle/dear_reviewer/issues/36)
