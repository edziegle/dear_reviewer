---
name: Dear Reviewer
description: A margin beside the editor where the Reviewer reads, asks and decides, dressed in whatever theme the editor wears.
colors:
  editor-background: "var(--vscode-editor-background)"
  foreground: "var(--vscode-foreground)"
  muted-foreground: "var(--vscode-descriptionForeground)"
  hairline: "var(--vscode-panel-border)"
  quiet-tint: "var(--vscode-editor-inactiveSelectionBackground)"
  link: "var(--vscode-textLink-foreground)"
  focus: "var(--vscode-focusBorder)"
  action-background: "var(--vscode-button-background)"
  action-foreground: "var(--vscode-button-foreground)"
  action-hover: "var(--vscode-button-hoverBackground)"
  secondary-background: "var(--vscode-button-secondaryBackground)"
  secondary-foreground: "var(--vscode-button-secondaryForeground)"
  input-background: "var(--vscode-input-background)"
  input-foreground: "var(--vscode-input-foreground)"
  input-border: "var(--vscode-input-border, transparent)"
  badge-background: "var(--vscode-badge-background)"
  badge-foreground: "var(--vscode-badge-foreground)"
  code-block: "var(--vscode-textCodeBlock-background)"
  quote-block: "var(--vscode-textBlockQuote-background)"
  problem-background: "var(--vscode-inputValidation-errorBackground)"
  problem-border: "var(--vscode-inputValidation-errorBorder)"
  check-passed: "var(--vscode-testing-iconPassed)"
  check-failed: "var(--vscode-testing-iconFailed)"
  check-running: "var(--vscode-testing-iconQueued)"
  finding: "var(--vscode-editorWarning-foreground)"
typography:
  title:
    fontFamily: "var(--vscode-font-family)"
    fontSize: "1.1em"
    fontWeight: 700
    lineHeight: "normal"
  headline:
    fontFamily: "var(--vscode-font-family)"
    fontSize: "1em"
    fontWeight: 700
    lineHeight: "normal"
  body:
    fontFamily: "var(--vscode-font-family)"
    fontSize: "var(--vscode-font-size)"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "var(--vscode-font-family)"
    fontSize: "0.9em"
    fontWeight: 400
    lineHeight: "normal"
  status:
    fontFamily: "var(--vscode-font-family)"
    fontSize: "0.85em"
    fontWeight: 400
    lineHeight: "normal"
  code:
    fontFamily: "var(--vscode-editor-font-family)"
    fontSize: "var(--vscode-editor-font-size)"
    fontWeight: 400
    lineHeight: "normal"
rounded:
  control: "2px"
  inline: "3px"
  bubble: "4px"
  pill: "8px"
  avatar: "50%"
spacing:
  2xs: "2px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
components:
  button-primary:
    backgroundColor: "{colors.action-background}"
    textColor: "{colors.action-foreground}"
    rounded: "{rounded.control}"
    padding: "4px 12px"
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
  button-secondary:
    backgroundColor: "{colors.secondary-background}"
    textColor: "{colors.secondary-foreground}"
    rounded: "{rounded.control}"
    padding: "2px 8px"
  button-link:
    textColor: "{colors.link}"
    padding: "0"
  input-message:
    backgroundColor: "{colors.input-background}"
    textColor: "{colors.input-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "4px 6px"
  chip-selection:
    backgroundColor: "{colors.badge-background}"
    textColor: "{colors.badge-foreground}"
    typography: "{typography.code}"
    rounded: "{rounded.inline}"
    padding: "1px 6px"
  status-pill:
    typography: "{typography.status}"
    rounded: "{rounded.pill}"
    padding: "0 6px"
  message-reviewer:
    backgroundColor: "{colors.quiet-tint}"
    typography: "{typography.body}"
    rounded: "{rounded.bubble}"
    padding: "8px"
  problem-banner:
    backgroundColor: "{colors.problem-background}"
    textColor: "{colors.foreground}"
    padding: "8px"
  avatar:
    backgroundColor: "{colors.quiet-tint}"
    rounded: "{rounded.avatar}"
    size: "24px"
---

# Design System: Dear Reviewer

## Overview

**Creative North Star: "The Margin Note"**

The Change's code is the page, and the code lives only in the editor. Dear Reviewer writes in the margin beside it: the timeline, the Assistant's replies and the Findings list are notes about the code, never a second copy of it (ADR 0012). A margin note is in the reader's own hand and the book's own ink. Every surface takes its color, type and controls from the active VS Code theme, and must look right in light, dark and high-contrast themes without a single theme-specific rule.

The system has almost nothing of its own on purpose. Native UI comes first: tree views, comment threads, gutter decorations, codicons, quick picks and the status bar. The two webviews, each Change's overview and the Assistant panel, exist only where no native view fits, and they behave like editor panels: compact, text-led, flat, divided by hairlines, readable for a whole working day. Density is the editor's density. A Reviewer who glances from the diff to the margin should notice the content, not the change of world.

Rejected on sight: the GitHub Pull Requests extension's webviews, which are slow, custom-styled review pages that look wrong next to VSCodium, and branded AI chat panels with gradients, glows, sparkle motifs or a face for the bot. The Assistant is a plain panel of prose, not a character.

**Key Characteristics:**

- Every color is a `--vscode-*` theme variable; the extension defines no palette.
- Type is the workbench font for prose and the editor font for anything code-shaped.
- Flat surfaces, 1px hairlines and sticky bars on the editor background.
- Controls copy VS Code's own: 2px corners, theme button colors, no flourish.
- Code appears in webviews only as plain quoted text; navigation happens in the editor.

## Colors

The palette is borrowed whole from the active theme; Dear Reviewer chooses roles, never values.

### Primary

- **Theme Action** (`action-background`, hover `action-hover`): the one filled button on a surface, such as Send in the Assistant or the action that fixes a problem. One per view at most.
- **Theme Link** (`link`): links, the pull-request title when it opens on GitHub, `path:line` references that open code in the editor, and text buttons such as Details.

### Secondary

- **Theme Secondary Action** (`secondary-background` on `secondary-foreground`): routine, repeatable actions that should not compete with the primary, such as Refresh on the timeline.

### Tertiary

- **Check Signals** (`check-passed`, `check-failed`, `check-running`): the outline of a check's status. The word inside stays in `foreground`: these are icon colors, meant for 3:1, and too faint for small text in light themes. Skipped and neutral checks use `muted-foreground`.
- **Finding** (`finding`): the Assistant's Findings: the tree icon, the overview-ruler mark and the gutter marker. A gutter icon can't take a theme color, so the marker is two SVGs in VS Code's default `editorWarning.foreground` for each theme kind: `#cca700` in `extension/media/finding.svg` for dark themes and `#bf8803` in `extension/media/finding-light.svg` for light ones. These are the only literal colors in the system; change them only if VS Code's defaults change.
- **Problem** (`problem-background` with a `problem-border` outline): the banner that says what went wrong, in words for the Reviewer.

### Neutral

- **Editor Ground** (`editor-background`): the surface behind sticky headers and footers, so they read as part of the editor rather than floating over it.
- **Ink** (`foreground`): all body text.
- **Pencil** (`muted-foreground`): dates, the pull-request reference, the Claude login, loading lines, notes from Dear Reviewer itself and the Assistant's working status.
- **Hairline** (`hairline`): every divider: header and footer rules, timeline rows, Markdown table cells.
- **Quiet Tint** (`quiet-tint`): the Reviewer's own messages and the empty avatar disc.
- **Code Ground** (`code-block`, `quote-block`): backgrounds for inline code, fenced blocks and quotes in rendered Markdown.
- **Badge** (`badge-background` on `badge-foreground`): selection chips that go with a message to the Assistant.

### Named Rules

**The Borrowed Ink Rule.** No literal color values in any surface. If a role has no `--vscode-*` variable, pick the nearest semantic one and give it a fallback inside `var()`; never write a hex value. The one exception is an image the editor draws that can't take a theme color, such as a gutter icon: give it light and dark variants in the theme color's default values.

**The Semantic Hue Rule.** Hue means state, never decoration: green for passed, red for failed or a problem, the warning color for Findings and for a Claude login billed per token. Nothing is colored only to look nice.

## Typography

**Body Font:** the workbench font (`--vscode-font-family` at `--vscode-font-size`)
**Code Font:** the editor font (`--vscode-editor-font-family` at `--vscode-editor-font-size`)

**Character:** Not a pairing but a hand-off: prose in the font the Reviewer chose for the workbench, code-shaped text in the font they chose for code. Dear Reviewer ships no fonts and sets no absolute sizes.

### Hierarchy

- **Title** (bold, 1.1em): the panel heading, which is the pull request's or Change's title.
- **Headline** (bold, 1em): section headings in a panel, such as Checks and Timeline.
- **Body** (regular, the theme size, line-height 1.5): messages, timeline bodies and rendered Markdown. Headings inside Markdown stay small (1.05–1.2em) so a reply can't outshout the panel.
- **Label** (regular, 0.9em, `muted-foreground`): metadata lines, the pull-request reference, the Claude login and the step list.
- **Status** (regular, 0.85em): check status pills and selection chips.
- **Code** (the editor font): commit SHAs, `path:line` chips, step subjects and Markdown code.

### Named Rules

**The Two Fonts Rule.** The workbench font for words, the editor font for anything a Reviewer might paste into a terminal or search for in the code. No third family, no web fonts.

**The Relative Size Rule.** Sizes are `em` multiples of the theme size, so a Reviewer's zoom and font settings carry through.

## Layout

The Assistant panel is a single column beside the editor (`ViewColumn.Beside`) with 16px side gutters, as wide as the Reviewer makes its group. The overview opens alone in the main column, so its content is a centred column capped at 64em with 24px gutters, and the Assistant's paragraph at 40em; with code open beside it, it narrows to whatever its group gives it. The header sticks to the top with 12px above and 8px below a hairline. The Assistant's message box sticks to the bottom the same way, so the conversation scrolls between two fixed rails.

Spacing steps are small and editor-scaled: 2, 4, 6, 8, 12 and 16px. Timeline rows have 10px of padding, a 10px gap between the 24px avatar and the content, and a hairline below. Messages sit 12px apart. Rows lay out with flex: a growing text column (`min-width: 0`, `overflow-wrap: anywhere`) beside fixed elements such as avatars, status pills and buttons, so long titles, logins and paths wrap instead of pushing controls off the edge.

Plain text keeps its line breaks (`pre-wrap`); rendered Markdown flows normally. Wide content, such as fenced code, scrolls inside its block, never the panel.

## Elevation & Depth

Flat. There are no shadows anywhere. Depth comes from three things only: 1px `hairline` rules, sticky header and footer bars on `editor-background` that cover content as it scrolls past, and tinted blocks (Quiet Tint, Code Ground, Problem) that set content apart from the ground.

### Named Rules

**The Hairline Rule.** Separate with a 1px `hairline` or a theme tint, never a shadow, gradient or blur. If something needs to float, it should be native VS Code UI (a quick pick, hover or notification), not a webview layer.

## Shapes

Corners are the editor's: nearly square. Buttons and the message box use 2px corners, the editor's control radius. Inline code, fenced blocks, quotes and selection chips use 3px. The Reviewer's message block uses 4px. Two shapes are fully round and mean something: check status pills (8px, outlined in their own state color) and avatars (circles, 24px). Banners and timeline rows have square corners.

Borders are 1px, used for hairline dividers, status-pill outlines, Markdown table cells and the problem banner. Icons are codicons in native UI; the extension's own SVGs are the activity-bar reading cat (`extension/media/dear-reviewer.svg`, a monochrome mask the theme colors) and the Finding lightbulb.

## Components

The feel of every control is quiet and editor-plain. If a control looks custom, it's wrong.

### Buttons

- **Shape:** nearly square (2px), with a 1px border in `--vscode-button-border`, else `--vscode-contrastBorder`, else transparent. Only high-contrast themes draw it, and there it is the button's only edge.
- **Primary:** `action-background` on `action-foreground`, 4px 12px padding, inheriting the body font. Used for Send, for a problem's fix, and in the overview for whatever comes next in the Review: the way in while files are unviewed, then the finishing button (see Change Overview).
- **Hover / Focus:** hover switches to `action-hover` with no transition. Focus shows a 1px `focus` outline; every button and link needs a visible `:focus-visible` state.
- **Disabled:** 50% opacity with the default cursor, such as Send while the Assistant works.
- **Secondary:** `secondary-background` on `secondary-foreground`, tighter (2px 8px), for the finishing button until every file is viewed, and for Retry beside a problem's fix.
- **Icon button:** Refresh, a 16px codicon glyph as inline SVG with 4px padding (a 24px target), no fill until hover (`toolbar-hoverBackground`).
- **Link:** no background, border or padding, in `link`, underlined on hover. Where it opens a page, such as the title or Details, it is an `a` with the `link` role; where it does something, such as Show all, a button. Inline in a sentence, as after a problem, it is always underlined, so it doesn't rely on color alone.

### Chips

- **Style:** selection chips use `badge-background` on `badge-foreground`, the editor font at 0.85em, 3px corners and 1px 6px padding. They read as `path · side · lines`, and a long path wraps inside the chip rather than running off a narrow panel.
- **State:** a chip waiting to be sent carries a close button, the codicon close glyph as inline SVG in a 20px target, named for the selection it drops; chips on a sent message have none.
- **Status pills:** a check's status as a word in `foreground`, in an 8px-round outline of its own state color, with no fill.

### Cards / Containers

- **Timeline row:** avatar, then author in bold, verb and muted date on one line, then the body; a hairline below. No card chrome.
- **Reviewer message:** the only filled message, in `quiet-tint` with 4px corners and 8px padding, so the Reviewer's words stand out from the Assistant's without either looking like a chat bubble app.
- **Assistant reply:** plain rendered Markdown on the ground, with no fill, no avatar and no visible name. Every message starts with a visually hidden speaker ("You:", "Assistant:", "Dear Reviewer:") so a screen reader can tell them apart.
- **Note:** Dear Reviewer's own remarks (new commits arrived, for example) in italic `muted-foreground`.
- **Problem banner:** the Assistant panel's alone. `problem-background` with a 1px `problem-border` outline, 8px padding, the message in plain words with backticked words in the editor font, and below it the button that helps, with Retry as a secondary beside it when `claude` couldn't start. While `claude` can't run, Send is off and the message box's placeholder says why.
- **Working line:** while the Assistant writes, its latest step in muted italic, the steps so far behind a disclosure, and a Stop link that ends the reply; the conversation goes on with the next message.

### Inputs / Fields

- **Style:** the Assistant's message box takes the `input-*` colors and a 1px `input-border` (transparent when the theme has none), 2px corners, 4px 6px padding and the body font. It resizes vertically from about two lines.
- **Focus:** a 1px `focus` outline drawn inside the border (offset -1px), as VS Code draws its own inputs.

### Navigation

Navigation is native: the activity-bar container holds the Inbox, Change Files and Findings tree views, with codicons (`account`, `git-branch`, `git-compare`, `lightbulb`, `error`, and `list-ordered` for a Reading Order's steps) and git decoration colors for file status. The status bar item shows the Dear Reviewer logo and `Assistant ready`. On a warning background it says `Assistant: billed per token`, `Assistant: not signed in` or `Assistant: Claude not found`. A status bar item shows only font glyphs, so the logo is also a one-glyph icon font, built from the activity-bar SVG. Its tooltip, headed Dear Reviewer Assistant, holds the Claude login, its `claude auth status` method and the `claude` executable. An untrusted review window adds a second, quiet item on the left, `$(workspace-untrusted) Navigation off`, with no background colour, which runs Trust the Review Window… to show Workspace Trust there; it hides once the window is trusted. Only the editor's own prompt asks about trust, once, never on every start (ADR 0021). Webviews never build their own navigation; links and `path:line` references go back to the extension, which opens them in the editor or the browser.

Each Change in Change Files carries its finishing actions as inline codicon buttons (`check-all` Submit Review or `note` Write Brief, `history` Show Timeline, `comment-discussion` Show Assistant), with the rest in its context menu, and says in its description whether there are new commits since the Reviewer's last Review, or, while there are none, that Review's verdict: `Approved`, `Changes requested` or `Commented`. Each file of a Change carries `comment-discussion` Ask the Assistant in its title bar, which hands the Assistant the selection, or else the lines on screen, and leaves the question to the Reviewer. The Inbox marks a pull request or branch `opening…` and then `open`. Review keys sit under one chord, `Ctrl+Alt+R`, so they don't take over keys the editor already uses.

### Change Overview (signature)

The only thing that opens when a Change opens: alone in the main column, with the focus, while the bottom panel closes and other Changes' editors go (ADR 0019, ADR 0020). Once the Reviewer starts, code opens in the column beside it, and the overview stays put. It reads top to bottom as four answers, each one line or one paragraph, and the Reading Order, then the history:

- **What is this:** the title (a link to the pull request) and a muted byline, `acme/api #482 · octocat → main`. Until the pull request loads, the title is its name and the byline is empty, so nothing shows twice.
- **How big, and is it healthy:** `12 files · +340 −58 · checks failed`, with tabular numerals, additions and deletions in the git decoration colors mixed 60% with `foreground` (`color-mix`), which keeps the hue and lifts small text past 4.5:1.
- **Where am I:** a muted line, `New commits since your Review · 2 pending Comments · 3 of 12 viewed`. While no new commits came since the Reviewer's last Review, the line opens with it in `foreground`: `✓ You approved at 14:32 · 3 Comments published`, `✗ You requested changes at 14:32` or `• You commented at 14:32`. Only the mark takes a hue: `check-passed` for approved, `check-failed` for changes requested, `muted-foreground` for commented. In an untrusted review window it ends `Navigation off: Trust the review window…`, a link that shows Workspace Trust. That says why go to definition does nothing, where the Reviewer is looking; it informs rather than asks, so ADR 0021's one prompt stays the only one.
- **Will its syntax highlight:** while some changed files have a file extension no installed language covers, a muted line under where the Reviewer stands, `No syntax highlighting for .tofu files. Find an Extension · Don't ask again`. Find an Extension opens the Extensions view with a search for the bare extension, `tofu`; with more than one, each extension is its own link. The Reviewer picks and installs; Dear Reviewer keeps no list of extensions to suggest. Don't ask again drops those extensions for good, in every Change. The line drops what an installed extension or `files.associations` comes to cover. Files without an extension, binary files and plain ones such as `.txt` or `.lock` never count.
- **The Assistant's take:** a small "Assistant" heading (or "Since your Review at `3f9c2a1`") over one paragraph of rendered Markdown, capped at 72ch. While it is written, a muted italic "Reading the Change…"; when `claude` can't run, a muted line with a link that helps and, when trying again can mend it, Retry. Both sit in one status region that screen readers hear only when its words change. Never a red banner: the overview works without the Assistant.
- **The Reading Order:** under the take, a small "Reading Order" heading over a numbered list of steps, each a semibold label with its files beneath: the path, a link in the editor font that opens its diff, then its reason, muted. A viewed file has a ✓ in `foreground` and a muted path; hue would claim it passed. While the order is written, a muted italic "Choosing an order to read the files in…"; once new commits make it out of date, a muted line says so with a Suggest again link (ADR 0022). A Change without one shows nothing here.

The take shows at most three sentences, with a Show all link (with `aria-expanded`) for the rest. Under it is one row of buttons: Start at `session.ts:42` (the take's first reference to a changed file, by file name, with the full path in its tooltip), Next unviewed file once the files are counted, and Ask the Assistant. The reference also stays a link inside the take's sentence, where its reason is. Refresh is an icon button beside the finishing button in the header. A hairline closes the overview, and the history follows: the pull request's timeline, or a local Change's commits, as a list. If the history can't load, a muted line under its heading says so in plain words with Retry; the rest of the overview is fine, so it doesn't shout.

**The Next Step Rule.** The overview fills only the button for what comes next. While files are unviewed, that is the way in: Start at, or Next unviewed file when the take names no file. Once every file is viewed, it is Submit Review… or Write Brief…, which stays in the same place in the sticky header throughout and is secondary until then. Tooltips give each button's `Ctrl+Alt+R` key.

**The Steady Focus Rule.** An update never moves the Reviewer's focus. The webviews rebuild only what changed, such as the reply being written or a history that loaded again, and if a rebuilt element had the focus, it goes to the element in the same place.

**The One Paragraph Rule.** The Assistant's take is at most three sentences and ends by naming where to start. The overview enforces it: anything longer waits behind Show all.

**The Breathing Room Rule.** Opening a Change shows one thing. Nothing opens beside the overview, below it or behind it until the Reviewer asks.

### Rendered Markdown

The shared reading style for timeline bodies and Assistant replies: tight margins (0.5em between blocks, no margin at the edges), small headings, `code-block` grounds for code, `quote-block` for quotes, hairline table cells, and links in `link` that open through the extension. Fenced code is plain text in the editor font with no syntax highlighting (ADR 0012).

## Do's and Don'ts

### Do:

- **Do** take every color from a `--vscode-*` variable, with a fallback inside `var()` when the theme may not define it, like `var(--vscode-input-border, transparent)`.
- **Do** reach for native UI first (tree views, comment threads, decorations, quick picks, status bar) and add a webview only when an ADR says why none fits.
- **Do** put styles both webviews use in `sharedStyles` in `extension/src/markdownPanel.ts`, never a copy in each panel.
- **Do** give every interactive element a visible `:focus-visible` outline in `focus`, and make links in rendered Markdown reachable with Tab and Enter.
- **Do** announce status to screen readers: `role="status"` for loading and working lines, `role="alert"` for the problem banner, and a visually hidden status line for changes that are otherwise only visual, such as a reply finishing. Set a live region's text only when it changes (`setText` in `sharedScript`), or every update speaks it again.
- **Do** keep the focus through updates with `keepFocus` in `sharedScript`, and build only the parts of a webview that changed.
- **Do** give every element that has a fill a theme border or outline that high-contrast themes draw: `--vscode-button-border` on buttons, `--vscode-contrastBorder` on tints such as the Reviewer's message and the avatar disc.
- **Do** color placeholders with `--vscode-input-placeholderForeground`; the browser's default gray fails contrast on dark themes.
- **Do** check every webview change in a light, a dark and a high-contrast theme in VSCodium.
- **Do** size type in `em` from the theme size, and use the editor font for SHAs, paths and code.

### Don't:

- **Don't** show the Change's code as code in a webview: no files, diffs, hunks, line numbers or syntax highlighting (ADR 0012).
- **Don't** write a literal color, except in an editor-drawn image that can't take a theme color, and then only the theme color's default values.
- **Don't** use shadows, gradients, blur or glow.
- **Don't** brand the Assistant: no avatar, mascot, gradient, sparkle motif or accent color for the bot in its panel. The status bar item, with Dear Reviewer's logo and a short state, is the only mark it gets.
- **Don't** build custom-styled review pages in the manner of the GitHub Pull Requests extension's webviews.
- **Don't** load web fonts or set absolute font sizes.
