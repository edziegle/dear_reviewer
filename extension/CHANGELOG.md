# Changelog

## [0.4.0](https://github.com/edziegle/dear_reviewer/compare/v0.3.0...v0.4.0) (2026-10-17)


### Features

* **assistant:** show the Assistant in the Secondary Side Bar ([ce18724](https://github.com/edziegle/dear_reviewer/commit/ce187248a78b4d4f00aed2fd6ceb12201e165fbd)), closes [#84](https://github.com/edziegle/dear_reviewer/issues/84)
* **code-flow:** add code flow view ([95b8f45](https://github.com/edziegle/dear_reviewer/commit/95b8f452a45f5ee969969b1b78fd81e5cdcb0930))
* keep a team-requested pull request in the Inbox once a teammate reviews it ([1b7f9d7](https://github.com/edziegle/dear_reviewer/commit/1b7f9d70a72e484b40b7c7a6b89119db6dc8f33c)), closes [#54](https://github.com/edziegle/dear_reviewer/issues/54)
* let the Reviewer ignore a pull request waiting on them ([8e72878](https://github.com/edziegle/dear_reviewer/commit/8e728780ca26eedf8917054623c3d78ba08fe713)), closes [#70](https://github.com/edziegle/dear_reviewer/issues/70)
* **overview:** give the Change overview a masthead ([fdd5501](https://github.com/edziegle/dear_reviewer/commit/fdd5501e678700735338072a14c41dcf70e69ee7)), closes [#37](https://github.com/edziegle/dear_reviewer/issues/37)
* refresh a pull request's Change when the window regains focus ([624ab60](https://github.com/edziegle/dear_reviewer/commit/624ab607e59d15584618c744e8efda1b48aed71a)), closes [#75](https://github.com/edziegle/dear_reviewer/issues/75)


### Bug Fixes

* keep a Comment being written when new commits arrive, and check what GitHub gives git ([c1a6fa0](https://github.com/edziegle/dear_reviewer/commit/c1a6fa0d1be1da760bc23511e39cb240c37233c2)), closes [#75](https://github.com/edziegle/dear_reviewer/issues/75)
* let go of a Change's state when another window closes it ([b4e0536](https://github.com/edziegle/dear_reviewer/commit/b4e053634685a617ab4a8c67537ca6179ac0c825)), closes [#56](https://github.com/edziegle/dear_reviewer/issues/56)
* **refresh:** run a focus check that met a running one when it ends ([93f09cc](https://github.com/edziegle/dear_reviewer/commit/93f09cc57c53b5c221a6880f6e008c66411b0732)), closes [#87](https://github.com/edziegle/dear_reviewer/issues/87)
* **refresh:** run the owed check whatever the gap ([c9e6b4c](https://github.com/edziegle/dear_reviewer/commit/c9e6b4cd4f705d38b2de56b65cb1289cbb1f2238)), closes [#87](https://github.com/edziegle/dear_reviewer/issues/87)
* start Change Files tall and Findings small in a fresh layout ([bdea6da](https://github.com/edziegle/dear_reviewer/commit/bdea6daa868fd9e76db4b36646cfb56ad92f90d0)), closes [#80](https://github.com/edziegle/dear_reviewer/issues/80)
* time out GitHub requests that never answer ([7520ef4](https://github.com/edziegle/dear_reviewer/commit/7520ef458c4cc8196ab7cf31cb9af2ff91d7b6e4)), closes [#65](https://github.com/edziegle/dear_reviewer/issues/65)

## [0.3.0](https://github.com/edziegle/dear_reviewer/compare/v0.2.1...v0.3.0) (2026-10-16)


### Features

* lay out In progress like Waiting on you ([cd8dbbe](https://github.com/edziegle/dear_reviewer/commit/cd8dbbe1550bab38994c7c180af5d26e18f159c2)), closes [#38](https://github.com/edziegle/dear_reviewer/issues/38)
* lead In progress with the Change shown last, and keep its rows light ([ab43cb3](https://github.com/edziegle/dear_reviewer/commit/ab43cb383959642394abe12f5a4edefba5439011)), closes [#38](https://github.com/edziegle/dear_reviewer/issues/38)
* make the Dashboard the side bar outside the review window ([a0f9dec](https://github.com/edziegle/dear_reviewer/commit/a0f9decd86e181b984d86d55bf5e0647a1bbf316)), closes [#38](https://github.com/edziegle/dear_reviewer/issues/38)
* show each pull request once, in progress or waiting ([b1c065d](https://github.com/edziegle/dear_reviewer/commit/b1c065d1bdb47b68889faa43113ce7827bb65151)), closes [#38](https://github.com/edziegle/dear_reviewer/issues/38)
* show loading with the editor's progress bar ([4d8c072](https://github.com/edziegle/dear_reviewer/commit/4d8c0726527b9075ac7fd1dc338e1b02998358af)), closes [#38](https://github.com/edziegle/dear_reviewer/issues/38)


### Bug Fixes

* keep the open-Changes list safe when several windows write it ([3ec50c4](https://github.com/edziegle/dear_reviewer/commit/3ec50c4c10d1616f44a5fe90e2816355ac6906e2)), closes [#55](https://github.com/edziegle/dear_reviewer/issues/55)

## [0.2.1](https://github.com/edziegle/dear_reviewer/compare/v0.2.0...v0.2.1) (2026-10-15)


### Bug Fixes

* keep the focus clear of Home's header and name each row's buttons ([#62](https://github.com/edziegle/dear_reviewer/issues/62)) ([fb0e4c3](https://github.com/edziegle/dear_reviewer/commit/fb0e4c3b376ed624c5e95d5491ff5d7aa2518563))

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
