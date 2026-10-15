# Changelog

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
