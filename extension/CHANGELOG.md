# Changelog

## [0.1.1](https://github.com/edziegle/dear_reviewer/compare/v0.1.0...v0.1.1) (2026-10-15)


### Bug Fixes

* let tests wait for the Inbox's refreshes ([0c4ec8b](https://github.com/edziegle/dear_reviewer/commit/0c4ec8b673abc6f94566405004bb06498b42ac87)), closes [#45](https://github.com/edziegle/dear_reviewer/issues/45)
* never publish a reply the Reviewer expects to wait for the Review ([a7fd78a](https://github.com/edziegle/dear_reviewer/commit/a7fd78acbcbfa01b356825b3b3ba8d364f589593)), closes [#31](https://github.com/edziegle/dear_reviewer/issues/31)

## [0.1.0](https://github.com/edziegle/dear_reviewer/compare/v0.0.1...v0.1.0) (2026-10-15)


### Features

* add a Reviewed by me group to the Inbox ([c42db09](https://github.com/edziegle/dear_reviewer/commit/c42db091e4a6526e283f16a7afcb732a32657629)), closes [#21](https://github.com/edziegle/dear_reviewer/issues/21)
* add follow-up Comments to the Reviewer's own pending threads ([52f18aa](https://github.com/edziegle/dear_reviewer/commit/52f18aaf4b0dbba3b7e9b7472deff06d2dac6f27)), closes [#31](https://github.com/edziegle/dear_reviewer/issues/31)
* ask the Assistant about the file you're reading from its title bar ([bc207c9](https://github.com/edziegle/dear_reviewer/commit/bc207c9d815fae341ec91d1edccb7cb715fbb486)), closes [#24](https://github.com/edziegle/dear_reviewer/issues/24)
* give the Assistant the Change's commits and its pull request's description ([572298a](https://github.com/edziegle/dear_reviewer/commit/572298af78bb7f28f08c0a9a6fc3bd94b03bb3a2)), closes [#27](https://github.com/edziegle/dear_reviewer/issues/27)
* label a new thread's button Start Review or Add Review Comment ([676d0ae](https://github.com/edziegle/dear_reviewer/commit/676d0ae14982d3777190fcdd1c07b2f5ed3ff56b)), closes [#30](https://github.com/edziegle/dear_reviewer/issues/30)
* let the Assistant read the Change's review threads and know where the Reviewer is reading ([05d464b](https://github.com/edziegle/dear_reviewer/commit/05d464b6cbc89014388ae135f21d9210221e0385)), closes [#26](https://github.com/edziegle/dear_reviewer/issues/26)
* mark a Change's file viewed from its title bar and tab menu ([d6d89b7](https://github.com/edziegle/dear_reviewer/commit/d6d89b7579fe124aa4091f6d3b869f4c9582a1d9)), closes [#32](https://github.com/edziegle/dear_reviewer/issues/32)
* name the Assistant's tab after its Change, not its commits ([6c4aaf9](https://github.com/edziegle/dear_reviewer/commit/6c4aaf92a6af3bd34b61dc546d2408ecbb41bd40)), closes [#28](https://github.com/edziegle/dear_reviewer/issues/28)
* offer Show Overview and Finish Review where the Reviewer finishes ([21c8309](https://github.com/edziegle/dear_reviewer/commit/21c8309c68f4228298a69d36867fa882e7ba2e09)), closes [#33](https://github.com/edziegle/dear_reviewer/issues/33)
* offer to find a language extension for unhighlighted files ([db7cd9e](https://github.com/edziegle/dear_reviewer/commit/db7cd9e14b0de23da843ba6ba948112d82d4ff1c)), closes [#29](https://github.com/edziegle/dear_reviewer/issues/29)
* open added and deleted files in a plain editor ([96cf6c5](https://github.com/edziegle/dear_reviewer/commit/96cf6c5b25b960700ed367629421be81f36991dc)), closes [#25](https://github.com/edziegle/dear_reviewer/issues/25)
* show a submitted Review's verdict and move it out of Awaiting my review ([212e1ba](https://github.com/edziegle/dear_reviewer/commit/212e1ba796af287b2c7ef0e8ebeb0cf7636dcf38)), closes [#34](https://github.com/edziegle/dear_reviewer/issues/34)
* show the Dear Reviewer logo and a short state in the Assistant's status bar item ([fe15786](https://github.com/edziegle/dear_reviewer/commit/fe15786d7b1cbfe34cdf8618dffd785aac9b4c3e)), closes [#22](https://github.com/edziegle/dear_reviewer/issues/22)
* suggest a Reading Order with the summary (ADR 0022) ([87c9224](https://github.com/edziegle/dear_reviewer/commit/87c922462f1421f5ed1d2aecb39b2a224832febe)), closes [#23](https://github.com/edziegle/dear_reviewer/issues/23)


### Bug Fixes

* act on no Change from a file whose Change isn't open in the window ([dcca3c6](https://github.com/edziegle/dear_reviewer/commit/dcca3c6c70247ebf3b0a92b8befdf7f0f6b0f66b)), closes [#33](https://github.com/edziegle/dear_reviewer/issues/33)
* mark viewed only the files a Change changes, from a tab or title bar ([6a01d8b](https://github.com/edziegle/dear_reviewer/commit/6a01d8b6ca5a89234ff55e24ec8e9b421490698d)), closes [#32](https://github.com/edziegle/dear_reviewer/issues/32)
* step to the next unviewed file from the overview's code column ([7c31c76](https://github.com/edziegle/dear_reviewer/commit/7c31c769cbd847e6fe787cb5d1d68f8b7353cc95)), closes [#36](https://github.com/edziegle/dear_reviewer/issues/36)
