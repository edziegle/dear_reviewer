---
status: accepted
date: 2026-10-13
---

# Render Markdown in the extension, sanitise it, and let the webviews only ask to open links and files

## Context and Problem Statement

The first real Review showed the Assistant's summary as raw Markdown (`## 1. …`, `**…**`), and the timeline shows pull request descriptions and Comments the same way (ADR 0008). Both panels need rendered Markdown. That text comes from other people, through GitHub, or from the Assistant, which reads other people's code. Both webviews have a strict content security policy, and the timeline opens only links the extension sent it. The Assistant's replies also point at code as `path:line` or `path:start-end`, which the Reviewer wants to click. Where should Markdown be rendered, how is it made safe, and how do links and file references open?

## Considered Options

- Render and sanitise in the extension with `markdown-it` and `sanitize-html`, and send the HTML in the panel state
- Bundle `markdown-it` and `DOMPurify` into a webview script, and render in the webview
- Keep plain text

## Decision Outcome

Chosen option: render and sanitise in the extension. The tests can check the sanitised HTML in the state the panel was sent, because they check webviews through their state and messages, not the DOM. Node has a real HTML parser to sanitise with, so the webviews need no extra script file, resource root or CSP change. Rendering in the extension also lets the extension record which links each panel shows.

- `src/markdown.ts` renders with `markdown-it`, with its `linkify` option on, and then runs `sanitize-html` with a short allow-list: paragraphs, headings, emphasis, code, lists, quotes, tables and `a`. No other attributes or tags get through, including `class`, `style`, `href` and `src`.
- Raw HTML is parsed only so it can be dropped: a tag never reaches the output, the text between tags stays (as GitHub shows it), and a script's or style's text goes with it. Turning raw HTML off in `markdown-it` would instead show the tags as escaped text, and pull request templates are full of `<!-- -->` and `<details>`.
- An image becomes a link to the image, so nothing loads from elsewhere. The CSP still has no remote `img-src`.
- A link carries its URL in `data-href` rather than `href`, and only `http` and `https` links become links. The webview opens nothing itself: it sends `openLink`, and the extension opens the URL with `vscode.env.openExternal` only if the URL appeared in what that panel was sent. The timeline keeps its header and check links as well.
- In Assistant replies, `path:line` and `path:start-end`, alone in inline code or in plain text, become `<a data-path data-start data-end>`. A path counts when it has a folder or an extension, so `10:30` doesn't. Clicking one sends `openReference`. The extension resolves a relative path against the head worktree and accepts an absolute one too. It opens the file at that range only when the file's real path, with symbolic links resolved, is inside the Change's head or base worktree. The system prompt asks the Assistant to cite code this way, because under ADR 0009 it would otherwise give absolute paths.
- Code uses the editor font.
- The Assistant's own messages keep their Markdown source in `text`, which is what the conversation saves. The panel adds `html` only to what it sends to the webview, and only for the Assistant's replies. The Reviewer's messages and notes stay plain text.
- While a turn runs, each tool call the Assistant makes becomes a step in the panel's state, such as "Reading `util.py`" or "Searching for `new_helper`", with paths relative to the worktree. The panel shows the latest step on one line, with the earlier ones in a collapsed list, and clears them when the reply is done. The steps come from the `tool_use` blocks in Claude Code's stream-json assistant messages.

This changes ADR 0008, whose panel showed descriptions, Comments and review summaries as plain text.

### Consequences

- Good, because the Reviewer reads formatted summaries, descriptions and Comments, and can jump from a reply straight to the code it means.
- Good, because a compromised or buggy webview still can't open arbitrary URLs or files outside the Change's worktrees: the extension checks every link and file reference.
- Good, because the Reviewer can see the Assistant is working, and on what, during a long turn.
- Bad, because the bundled `dist/extension.js` grows to about 740 KB, most of it `markdown-it` and `sanitize-html` with its HTML and CSS parsers, which `esbuild` bundles so the package needs no `node_modules`.
- Bad, because the extension re-renders a reply on every streamed delta. That is cheap for reply-sized text, but grows with the length of the conversation.
- Bad, because dropping raw HTML loses what only HTML carried, such as an `<img>` screenshot in a description.
- Bad, because a reference that names a file under another folder, or a `host:port`, looks like a file reference; clicking one that isn't a file in the worktrees does nothing.
