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
  assistant: "var(--vscode-dearReviewer-assistantForeground)"
  finding: "{colors.assistant}"
typography:
  title:
    fontFamily: "var(--vscode-font-family)"
    fontSize: "1.1em"
    fontWeight: 700
    lineHeight: "normal"
  masthead-title:
    fontFamily: "var(--vscode-font-family)"
    fontSize: "1.6em"
    fontWeight: 700
    lineHeight: 1.25
  masthead-facts:
    fontFamily: "var(--vscode-font-family)"
    fontSize: "1.25em"
    fontWeight: 400
    lineHeight: "normal"
  section-label:
    fontFamily: "var(--vscode-font-family)"
    fontSize: "0.85em"
    fontWeight: 700
    lineHeight: "normal"
    letterSpacing: "0.04em"
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

The system has almost nothing of its own on purpose. Native UI comes first: tree views, comment threads, gutter decorations, codicons, quick picks and the status bar. The four webviews, each Change's overview, the Dashboard, the Assistant's view and the Code Flow, exist only where no native view fits, and they behave like editor panels: compact, text-led, flat, divided by hairlines, readable for a whole working day. Density is the editor's density. A Reviewer who glances from the diff to the margin should notice the content, not the change of world.

Rejected on sight: the GitHub Pull Requests extension's webviews, which are slow, custom-styled review pages that look wrong next to VSCodium, and branded AI chat panels with gradients, glows, sparkle motifs or a face for the bot. The Assistant is not a character, but it writes in a hand of its own: a rule down the margin of what it says, headed by the reading cat and its name, in the one color the extension adds (ADR 0031).

**Key Characteristics:**

- Every color is a `--vscode-*` theme variable; the extension adds one, the Assistant's, which a theme can set.
- Type is the workbench font for prose and the editor font for anything code-shaped.
- Flat surfaces, 1px hairlines and sticky bars on the editor background.
- Controls copy VS Code's own: 2px corners, theme button colors, no flourish.
- Code shows in webviews only as plain quoted text; navigation happens in the editor.

## Colors

The palette is borrowed whole from the active theme; Dear Reviewer chooses roles, never values.

### Primary

- **Theme Action** (`action-background`, hover `action-hover`): the one filled button on a surface, such as Send in the Assistant or the action that fixes a problem. One per view at most.
- **Theme Link** (`link`): links, the pull-request title when it opens on GitHub, `path:line` references that open code in the editor, and text buttons such as Details.

### Secondary

- **Theme Secondary Action** (`secondary-background` on `secondary-foreground`): routine, repeatable actions that should not compete with the primary, such as Refresh on the timeline.

### Tertiary

- **Check Signals** (`check-passed`, `check-failed`, `check-running`): the outline of a check's status. The word inside stays in `foreground`: these are icon colors, meant for 3:1, and too faint for small text in light themes. Skipped and neutral checks use `muted-foreground`.
- **Assistant** (`assistant`): the extension's one color, `dearReviewer.assistantForeground`, which defaults to the theme's `charts.purple` in every theme kind and which a theme or `workbench.colorCustomizations` can set. It marks whatever the Assistant says and nothing else: the rule and the cat of the Assistant's Hand, and its Findings in the editor. It is an icon and rule color, not a text color: the name beside the cat stays in `foreground`.
- **Finding** (`finding`, which is `assistant`): the Assistant's Findings: the tree icon, the overview-ruler mark and the gutter marker. A one-line Finding's marker is the lightbulb. A longer one's first line shows the lightbulb with a bar down its left edge, and its other lines the bar alone, so the bar runs unbroken to its last line. A gutter icon can't take a theme color, so each icon is two SVGs in `charts.purple`'s default for each theme kind: `#b180d7` in `extension/media/finding.svg`, `finding-start.svg` and `finding-bar.svg` for dark themes, and `#652d90` in `finding-light.svg`, `finding-start-light.svg` and `finding-bar-light.svg` for light ones. These are the only literal colors in the system; change them only if VS Code's defaults change. A theme that sets the Assistant's color moves the overview-ruler mark and the tree icon, but not the gutter.
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

**The Semantic Hue Rule.** Hue means state, never decoration: green for passed, red for failed or a problem, the Assistant's color for what the Assistant says, Findings included, and the warning color for a Claude login billed per token. Nothing is colored only to look nice.

## Typography

**Body Font:** the workbench font (`--vscode-font-family` at `--vscode-font-size`)
**Code Font:** the editor font (`--vscode-editor-font-family` at `--vscode-editor-font-size`)

**Character:** Not a pairing but a hand-off: prose in the font the Reviewer chose for the workbench, code-shaped text in the font they chose for code. Dear Reviewer ships no fonts and sets no absolute sizes.

### Hierarchy

- **Masthead Title** (bold, 1.6em, line-height 1.25, balanced): the overview's title, the one large line in Dear Reviewer (see The Masthead Rule). In a column 640px or narrower, such as beside code, it steps down to 1.3em and the facts line to 1.1em, so the sticky header doesn't take the screen.
- **Masthead Facts** (regular, 1.25em, tabular numerals): the overview's facts line under it.
- **Title** (bold, 1.1em): a panel heading elsewhere.
- **Headline** (bold, 1em): section headings in a panel, such as Your Review.
- **Section Label** (bold, 0.85em, uppercase, 0.04em tracking): the overview's sections below the masthead, Checks, the history and the Reading Order, headed as the editor heads its own views. A SHA in one keeps its case, in the editor font.
- **Body** (regular, the theme size, line-height 1.5): messages, timeline bodies and rendered Markdown. Headings inside Markdown stay small (1.05–1.2em) so a reply can't outshout the panel, and sit two levels below the panel's own (`# Title` becomes an `h3`), so a description's headings don't break the page's outline.
- **Label** (regular, 0.9em, `muted-foreground`): metadata lines, the pull-request reference, the Claude login and the step list.
- **Status** (regular, 0.85em): check status pills and selection chips.
- **Code** (the editor font): commit SHAs, `path:line` chips, step subjects and Markdown code.

### Named Rules

**The Two Fonts Rule.** The workbench font for words, the editor font for anything a Reviewer might paste into a terminal or search for in the code. No third family, no web fonts.

**The Relative Size Rule.** Sizes are `em` multiples of the theme size, so a Reviewer's zoom and font settings carry through.

**The Masthead Rule.** Only the overview's masthead, its title and facts line, is set larger than the theme size; nothing else in Dear Reviewer is. It is what makes the overview recognizably Dear Reviewer's without a color or font of its own: scale at the top, editor-plain below. Everything under the masthead reads at body size or smaller, so the masthead stays the one peak.

## Layout

The Assistant's view is a single column in the Secondary Side Bar with 12px side gutters, as the Dashboard has, on the side bar's ground, as wide as the Reviewer makes the side bar; the Assistant's replies keep to 80ch of it (ADR 0038). The overview opens alone in the main column, so its content is a centred column capped at 64em with 24px gutters, and the Assistant's paragraph at 40em; with code open beside it, it narrows to whatever its group gives it. The header sticks to the top with 12px above and 8px below a hairline, and a page in the main column keeps the focus clear of it as it scrolls (`scroll-padding-top`). The Assistant's message box sticks to the bottom the same way, so the conversation scrolls between two fixed rails.

Spacing steps are small and editor-scaled: 2, 4, 6, 8, 12 and 16px. Timeline rows have 10px of padding, a 10px gap between the 24px avatar and the content, and a hairline below. Messages sit 12px apart. Rows lay out with flex: a growing text column (`min-width: 0`, `overflow-wrap: anywhere`) beside fixed elements such as avatars, status pills and buttons, so long titles, logins and paths wrap instead of pushing controls off the edge.

Plain text keeps its line breaks (`pre-wrap`); rendered Markdown flows normally. Wide content, such as fenced code, scrolls inside its block, never the panel.

## Elevation & Depth

Flat. Nothing has a shadow. Depth comes from three things only: 1px `hairline` rules, the Assistant's rule, sticky header and footer bars on `editor-background` that cover content as it scrolls past, and tinted blocks (Quiet Tint, Code Ground, Problem) that set content apart from the ground.

### Named Rules

**The Hairline Rule.** Separate with a 1px `hairline` or a theme tint, never a shadow, gradient or blur. If something needs to float, it should be native VS Code UI (a quick pick, hover or notification), not a webview layer.

## Shapes

Corners are the editor's: nearly square. Buttons and the message box use 2px corners, the editor's control radius. Inline code, fenced blocks, quotes and selection chips use 3px. The Reviewer's message block uses 4px. Two shapes are fully round and mean something: check status pills (8px, outlined in their own state color) and avatars (circles, 24px). Banners and timeline rows have square corners.

Borders are 1px, used for hairline dividers, status-pill outlines, Markdown table cells and the problem banner. The one exception is the Assistant's rule, 2px so it carries its color, the same weight as a Finding's gutter bar. Icons are codicons in native UI; the extension's own SVGs are the activity-bar reading cat (`extension/media/dear-reviewer.svg`, a monochrome mask the theme colors), which the webviews also draw as the Assistant's mark (`extension/src/assistantMark.ts`, its coordinates rounded), and the Finding lightbulb.

## Components

The feel of every control is quiet and editor-plain. If a control looks custom, it's wrong.

### Buttons

- **Shape:** nearly square (2px), with a 1px border in `--vscode-button-border`, else `--vscode-contrastBorder`, else transparent. Only high-contrast themes draw it, and there it is the button's only edge.
- **Primary:** `action-background` on `action-foreground`, 4px 12px padding, inheriting the body font, except the overview header's finishing button, which keeps the secondary's 2px 8px so the header doesn't change height when it fills. Used for Send, for a problem's fix, and in the overview for whatever comes next in the Review: the way in while files are unviewed, then the finishing button (see Change Overview).
- **Hover / Focus:** hover switches to `action-hover` at once. Focus shows a 1px `focus` outline; every button and link needs a visible `:focus-visible` state.
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
- **Reviewer message:** the only filled message, in `quiet-tint` with 4px corners and 8px padding, so the Reviewer's words stand out from the Assistant's without either resembling a chat bubble app.
- **Assistant reply:** rendered Markdown on the ground in the Assistant's Hand: no fill, the cat and "Assistant" over it as an `h2`, so headings inside the reply sit below it, and its rule down the left. The Reviewer's and Dear Reviewer's messages start with a visually hidden speaker ("You:", "Dear Reviewer:") so a screen reader can tell them apart; the Assistant's name is visible, and the cat beside it is hidden from screen readers.
- **Note:** Dear Reviewer's own remarks (new commits arrived, for example) in italic `muted-foreground`.
- **Problem banner:** the Assistant's view's alone. `problem-background` with a 1px `problem-border` outline, 8px padding, the message in plain words with backticked words in the editor font, and below it the button that helps, with Retry as a secondary beside it when `claude` couldn't start. While `claude` can't run, Send is off and the message box's placeholder says why.
- **Working line:** in the Assistant's rule, without the cat, while the Assistant writes: its latest step in muted italic, the steps so far behind a disclosure, and a Stop link that ends the reply; the conversation goes on with the next message.

**The Assistant's Hand Rule.** Wherever the Assistant speaks in a webview, its words sit behind a 2px rule in the Assistant's color, headed by the reading cat in that color and "Assistant" in `foreground`, at label size and semibold. The hand has no fill, so the Reviewer's filled messages stay the main flow. Nothing else uses its color or its cat, so a Reviewer can tell the Assistant's words from the Reviewer's own, from GitHub's and from Dear Reviewer's at a glance; the one other rule in the overview, the result block's, takes a state color and has no cat or name. In the editor, the Finding's gutter bar is the same rule.

### Inputs / Fields

- **Style:** the Assistant's message box and the Submit step's summary take the `input-*` colors and a 1px `input-border` (transparent when the theme has none), 2px corners, 4px 6px padding and the body font. They resize vertically from about two lines (`textarea` in `sharedStyles`).
- **Choices:** the Submit step's verdict is a group of the browser's radio buttons tinted `action-background`, or `contrastActiveBorder` in high-contrast themes, where the button's fill is the ground (`accent-color`), each with its label in `foreground` and what it does muted beside it.
- **Focus:** a 1px `focus` outline drawn inside the border (offset -1px), as VS Code draws its own inputs.

### Navigation

Navigation is native: the activity-bar container holds the Dashboard in the Reviewer's own windows, and Change Files and Findings tree views in the review window, and the Secondary Side Bar's Assistant container holds the Assistant's view, titled with the Change whose conversation it shows. With no Change open it shows a muted line and one filled button, Open Assistant, in place of the header and message box, with codicons (`git-compare`, `lightbulb`, `error`, and `list-ordered` for a Reading Order's steps) and git decoration colors for file status. The status bar item shows the Dear Reviewer logo and `Assistant ready`. On a warning background it says `Assistant: billed per token`, `Assistant: not signed in` or `Assistant: Claude not found`. A status bar item shows only font glyphs, so the logo is also a one-glyph icon font, built from the activity-bar SVG. Its tooltip, headed Dear Reviewer Assistant, holds the Claude login, its `claude auth status` method and the `claude` executable. An untrusted review window adds a second, quiet item on the left, `$(workspace-untrusted) Navigation off`, with no background color, which runs Trust the Review Window… to show Workspace Trust there; it hides once the window is trusted. Only the editor's own prompt asks about trust, once, never on every start (ADR 0021). Webviews never build their own navigation; links and `path:line` references go back to the extension, which opens them in the editor or the browser.

The Code Flow's toolbar has View (Call map, swimlanes, List), Show (Changed only, +1 hop, +2 hops) and Show tests, a toggle button with `aria-pressed` in the same segmented style, which stays in every view. Test code is left out until the Reviewer shows it, and a notice beside a Show tests button says how many test symbols were left out, in the way the notice about symbols left out to keep the map readable does. A Change that touches only tests says so, rather than drawing an empty map. A notice about a language server says which of three things happened: there is none, with a button that searches extensions for one; it timed out, with Try again; or it knows the symbols but gives no calls, with no button, since asking again gets the same answer, and with a line that says to install a server that supports call hierarchies. An update keeps the focus on Show tests (the Steady Focus Rule).

Change Files joins a folder whose only child is a folder into one row, such as `infra/modules/vpc`, as the Explorer does while `explorer.compactFolders` is on. Each Change in Change Files carries `info` Show Overview and `comment-discussion` Show Assistant as inline codicon buttons, with the rest, Submit Review… or Write Brief… among them, in its context menu. Finishing has no button of its own there or on a Change's files: the overview, which Show Overview brings back, is where a Review ends (ADR 0033). The row says in its description whether there are new commits since the Reviewer's last Review, or, while there are none, that Review's verdict: `Approved`, `Changes requested` or `Commented`. Each file of a Change carries `comment-discussion` Ask the Assistant in its title bar, which hands the Assistant the selection, or else the lines on screen, and leaves the question to the Reviewer. The Inbox marks a pull request or branch `opening…` and then `open`. Review keys sit under one chord, `Ctrl+Alt+R`, so they don't take over keys the editor already uses. Show Review Keys opens Keyboard Shortcuts filtered to Dear Reviewer, where any of them can be rebound, such as for a keyboard layout where Ctrl+Alt is AltGr. Finishing has one name everywhere: Submit Review… for a pull request and Write Brief… for a local Change, in the palette (which offers only the one that fits the Active Change), the overview, the offer once every file is viewed and the Dashboard; `Ctrl+Alt+R S` runs whichever fits the Change.

Fetch Updates (`cloud-download`, beside Refresh in the Change Files title bar, and in the palette) brings in a pull request's new commits and review threads when asked, and says in a notification what it found, such as `acme/api #7: 1 new commit.` The window also does it by itself whenever it regains focus, unless `dearReviewer.autoRefreshChanges` is off, with no notification and no error: a swap to a new head reopens the file the Reviewer was on, and the overview's place line starts with `1 new commit arrived`, then `New commits since your Review` where that applies. With no timer, an idle window sends nothing (ADR 0036).

Open Pull Request or Branch… is the Dashboard's door for the keyboard: a palette quick pick of the same pull requests and branches, each once under its Dashboard heading, filtered by repository, number, title or author, and opening the one chosen as the Dashboard's title does. Clicking Dear Reviewer in the activity bar of the Reviewer's own window shows the Dashboard, the side bar's one view there (ADR 0032); Show Dashboard and `Ctrl+Alt+R H` bring it too. The review window's side bar holds Change Files and Findings, for the Active Change, and no Dashboard. A fresh layout gives Change Files five parts of the height to Findings' one (`size` on each view in the manifest), so the tree fills the side bar and Findings takes little more than its welcome text and the Ask for Findings button. A Reviewer who drags the views keeps their sizes, since VS Code saves them. Change Files and Findings show only in the review window, the one window that holds a Change (ADR 0040). A Change's title-bar actions, such as Ask for Findings, Fetch Updates and Refresh, show only while one is open, and Findings' welcome offers Ask for Findings only then.

### Change Overview (signature)

The only thing that opens when a Change opens: alone in the main column, with the focus, while the bottom panel closes and other Changes' editors go (ADR 0019, ADR 0020). Once the Reviewer starts, code opens in the column beside it, and the overview stays put. It reads top to bottom as four answers, each one line or one paragraph, and the Reading Order, then the history:

- **What is this:** the title (a link to the pull request, at masthead size in `foreground`, taking the link color and underline on hover) and a muted byline, `acme/api #482 · octocat → main`. Until the pull request loads, the title is its name and the byline is empty, so nothing shows twice.
- **How big, and is it healthy:** `12 files · +340 −58 · ✗ checks failed`, at masthead size with muted separators, the checks' mark in its state color (`✗` in `check-failed`, `✓` in `check-passed` mixed 70% with `foreground`; running checks have no verdict, so no mark) and the words in `foreground`, with tabular numerals, additions and deletions in the git decoration colors mixed 60% with `foreground` (`color-mix`), which keeps the hue and lifts small text past 4.5:1.
- **Your place:** a muted line, `New commits since your Review · 2 pending Comments · 3 of 12 viewed`. While no new commits came since the Reviewer's last Review, the line opens with it in `foreground`: `✓ You approved at 14:32 · 3 Comments published`, `✗ You requested changes at 14:32` or `• You commented at 14:32`. Only the mark takes a hue: `check-passed` for approved, `check-failed` for changes requested, `muted-foreground` for commented. In an untrusted review window it ends `Navigation off: Trust the review window…`, a link that shows Workspace Trust. That says why go to definition does nothing, where the Reviewer is looking; it informs rather than asks, so ADR 0021's one prompt stays the only one.
- **Will its syntax highlight:** while some changed files have a file extension no installed language covers, a muted line below the checks, after everything about the Change, since it is about the Reviewer's setup and not the Change, `No syntax highlighting for .tofu files. Find an Extension · Don't ask again`. Find an Extension opens the Extensions view with a search for the bare extension, `tofu`; with more than one, each extension is its own link. The Reviewer picks and installs; Dear Reviewer keeps no list of extensions to suggest. Don't ask again drops those extensions for good, in every Change. The line drops what an installed extension or `files.associations` comes to cover. Files without an extension, binary files and plain ones such as `.txt` or `.lock` never count.
- **The Assistant's take:** in the Assistant's Hand, which holds the Reading Order too: the cat and "Assistant" as its heading, followed by a muted "· Since your Review at `3f9c2a1`" when it explains new commits, over one paragraph of rendered Markdown, capped at 40em. While it is written, a muted italic "Reading the Change…"; when `claude` can't run, a muted line with a link that helps and, when trying again can mend it, Retry. Both sit in one status region that screen readers hear only when its words change. Never a red banner: the overview works without the Assistant.
- **The Reading Order:** under the take, a "Reading Order" section label, an `h3` under the Assistant's `h2`, over a numbered list of steps, each a semibold label with its files beneath: the path, a link in the editor font that opens its diff, then its reason, muted. A viewed file has a ✓ in `foreground` and a muted path; hue would claim it passed. While the order is written, a muted italic "Choosing an order to read the files in…"; once new commits make it out of date, a muted line says so with a Suggest again link (ADR 0022). When the Assistant couldn't write one, because its turn failed or its reply held no usable order, a muted line says `The Assistant couldn't order the files, so they stay as they are in the Change.` with Try again, so the Reviewer can tell a failure from an order still to come. A Change that hasn't asked for one shows nothing here.

The take shows at most three sentences, with a Show all link (with `aria-expanded`) for the rest. Under it is one row of buttons: Start at `session.ts:42` (the take's first reference to a changed file, by file name, with the full path in its tooltip), Next unviewed file once the files are counted, and Ask the Assistant. The reference also stays a link inside the take's sentence, where its reason is. Refresh is an icon button beside the finishing button in the header. A hairline closes the overview. A pull request's checks on its latest commit come next: the section label `Checks on 9be41d7: failed`, a muted summary in tabular numerals (`1 failed · 1 running · 38 passed`), then the failed and running checks as status pills with their Details, and the rest behind Show all with the count (`Show all 41`, with `aria-expanded`); five checks or fewer show whole. The history follows: the pull request's timeline, or a local Change's commits, as a list. If the history can't load, a muted line under its heading says so in plain words with Retry; the rest of the overview is fine, so it doesn't shout.

**The Submit step** (ADR 0033). A pull request's Review ends here. Submit Review…, from the header or anywhere else (the palette, `Ctrl+Alt+R S`, the offer once every file is viewed, the Dashboard's next step), brings the overview forward with the step open under the header, under a hairline of its own and the heading Your Review, and the focus on its verdict. While it is open, the header's Submit Review… hides, since the step has its own Submit Review, Cancel and Escape, and a button of the same name would do the opposite; Cancel returns the focus to it. The step holds:

- **Verdict:** Comment, Approve or Request Changes, in GitHub's order and words, each with what it does, muted, which describes the radio rather than naming it. None is chosen until the Reviewer chooses, since the verdict publishes; Submit Review stays off with `Choose a verdict.` On the Reviewer's own pull request, GitHub takes only a comment, so the step shows Comment alone, chosen, as a line rather than a radio, since it is no choice, with a muted `On your own pull request, GitHub takes only a comment.` Choosing Approve while the checks on the latest commit failed adds a muted `Checks failed on 9be41d7.`, which warns without blocking. Approving while the head's checks have failed doesn't block it, but a line under the verdicts says so in `foreground` after a ✗ in `check-failed`, `Checks failed on 9be41d7. Approve only if that is expected.`, which a screen reader hears as soon as it shows.
- **Summary:** "Summary", with a muted "shown with your Review", the message box at up to 40em. Ctrl+Enter submits from anywhere in the step; Escape cancels and puts the focus back on the header's button. The verdict and summary are a draft the webview keeps (`vscode.setState`).
- **What publishes:** `3 Comments publish with it:` over one row per pending Comment, in file and line order, the first five, then Show all with the count (`Show all 9`, with `aria-expanded`) so Submit stays in reach: its `path:line` as a link in the editor font, which opens the Comment's thread in the diff, then its first line of words, muted, and `before the change` for one on the base side. Never the code around it. With none, `No pending Comments: only your summary and verdict publish.`
- **Actions:** Submit Review, filled, named `Submit Review to GitHub` for screen readers so it isn't the header button's name, and Cancel, secondary. Until the overview has loaded its pending Comments, both it and the header's button are unavailable (`aria-disabled`, `Loading your Review…`). A blocked press says why again, as a status, and takes the focus to what is missing. Commenting or requesting changes without a summary or a Comment is refused before GitHub refuses it: Submit Review is off, and a muted line under the summary says what to add.
- **Submitting:** the button says Submitting… and the progress bar runs. Then the step closes and the result block takes its place, and a visually hidden status line says what published (`Approved acme/api #482 and published 3 Comments.`). No toast. If GitHub refuses, the step keeps its draft and says why in plain words after a ✗ in `check-failed`, with the link that helps, such as Sign In to GitHub. A refusal it can't name says what is known (`GitHub didn't take your Review. Your draft is kept.`), offers Open the pull request on GitHub, and keeps GitHub's own words behind a Details disclosure in the link color, since it is the only way to them.

**The result block** (ADR 0034). Every Review ends on a result under the header, in place of the standing line's account of it, behind a 2px rule in the result's state color (`check-passed` for an approval, a copied Brief or nothing to brief, `check-failed` for changes requested or a problem, `muted-foreground` otherwise), with the sentence of a finished Review semibold at the body size in `foreground`, and a mark (`✓` in `check-passed` for an approval, `✗` for changes requested, `•` for a comment, `✓` for a Brief), over its buttons, of which exactly one is filled:

- **A pull request, submitted or covering the head with nothing pending:** `✓ Approved acme/api #482 and published 3 Comments` (`✓ You approved at 14:32 · 3 Comments published` once reopened), then Close Change, filled, which closes the Change, and the review window too when it was the last Change open there (the window asks about unsaved editors itself; a Change that ends on its own, or a newer head replacing an older, never closes it), and View on GitHub, secondary. The filled Close Change takes the focus when the step closes, and what the block says is announced once, by the page's own status line.
- **A local Change, while the Assistant writes the Brief:** a muted italic `The Assistant is writing a Brief of 3 Comments…`, in a status region, with the progress bar. If it can't, a `✗` line says why in plain words, with Try again, secondary, beside the header's Write Brief….
- **A local Change, once the Brief is written:** `A Brief of 3 Comments is open in the editor. Read and edit it, then copy it for your agent.` Copy Brief is filled, Show Brief is secondary, and Discard pending Comments… is a link, the same words as in the Submit step. If the Brief's file was deleted, the block says so and offers Write Brief… to write it again.
- **A local Change with every file viewed and no Comments:** `✓ Nothing to brief. You found nothing to change.`, then Close Change, filled. No Brief can be written, so Write Brief… isn't offered, in the header or the palette, until a Comment exists.
- **A local Change, once the Brief is copied:** `✓ You copied a Brief at 14:32 · 3 Comments`, then Close Change, filled, and Show Brief, secondary.

While the block shows, Start at, Next unviewed file, the syntax-highlighting line and the header's finishing button step back, and the Assistant's take and Reading Order fold behind one link, Show the Assistant's take (`aria-expanded`), closed again each time the block shows. The facts line and checks stay as reference. New commits since the Review clear the block, and the Review begins again. Stepping past the last unviewed file brings the overview forward with the focus on the filled finishing button, with no toast. The Submit step offers Discard pending Comments… as a link too.

**The Next Step Rule.** The overview fills only the button for what comes next. While files are unviewed, that is the way in: Start at, or Next unviewed file when the take names no file. Once every file is viewed, it is Submit Review… or Write Brief…, which stays in the same place in the sticky header throughout and is secondary until then. It is secondary again while the Submit step is open, whose own Submit Review is the filled one, and once a Review covers the head with no Comments pending, when there is nothing to finish. Next unviewed file, Ask the Assistant and the finishing button show their key beside the label, in the editor font and the Reviewer's own notation (`Ctrl+Alt+R N`, or `⌃⌥R N` on a Mac), which isn't part of the name a screen reader gives the button; tooltips give it too. The Dashboard follows the same rule across all the Reviewer's Changes (see Dashboard).

**The Steady Focus Rule.** An update never moves the Reviewer's focus. The webviews rebuild only what changed, such as the reply being written or a history that loaded again, and if a rebuilt element had the focus, it goes to the element in the same place. When the focused element hides or is disabled, such as Stop once a reply ends or the last selection chip removed, the focus goes to the element in the same place, else the panel's default (the Assistant's message box), else the nearest one before it; never to the page. A button that waits on the extension, such as Submit Review while GitHub takes the Review, is `aria-disabled` rather than disabled, so it keeps the focus.

**The One Paragraph Rule.** The Assistant's take is at most three sentences and ends by naming where to start. The overview enforces it: anything longer waits behind Show all.

**The Breathing Room Rule.** Opening a Change shows one thing. Nothing opens beside the overview, below it or behind it until the Reviewer asks.

### Dashboard

The Dear Reviewer side bar in the Reviewer's own windows (ADR 0032): where they stand across their Changes and the way into the next review, a Change overview for every Change at once, sized for the side bar. Its title reads Dear Reviewer: Dashboard, with Refresh and Add Repository… in its title bar and Forget Repository… and Set Up Dear Reviewer behind its `…`. It has 12px side gutters, no header of its own, and reads top to bottom, answer lines first and the lists after:

- **The facts line:** `6 waiting on you · oldest 4 days`, with tabular numerals, or `Nothing waiting on you`. It counts every pull request waiting on the Reviewer, open as a Change or not. Active Change names its own Change in its heading, right below, so the line doesn't repeat it. Until the Inbox can tell what's waiting, such as before sign-in, there's no facts line.
- **The place line:** shown only when the next step is a pull request not yet open, to say why it is next, such as `acme/billing #19 has waited longest on you: 4 days`. For the Active Change the button names it, and its Active Change row says where the Reviewer left off, so neither is said a third time.
- **The next step:** one filled button the width of the side bar, up to 300px, as the editor's own welcome buttons are, under the Next Step Rule. It resumes the Change shown last that still needs the Reviewer (`Resume acme/api #482`), or, once every file is viewed, finishes it, naming it: `Submit Review of acme/api #482…` or `Write Brief for fix-retry…`; a local Change with no Comments has nothing to brief, so it is `Close fix-retry`. With no such Change, it is `Review acme/billing #19`, the pull request that has waited longest and isn't open yet. A Change whose last Review covers its head, with no Comments pending, needs nothing. With no next step, the place line and the button don't show. A hairline closes this part.
- **Lists:** each under a bold heading with its count muted beside it, such as `Waiting on you 6`, in rows divided by hairlines. A list with nothing in it doesn't show, and one of more than five rows shows the first five, then a Show all link with the count (`Show all 21`, with `aria-expanded`); Active Change, which holds only the one Change, shows whole. Up and down move between a list's rows. Titles wrap; the muted lines under them, and where the Reviewer left off, keep to one line, cut short with an ellipsis, with the whole line on hover, so a long branch or login doesn't stretch a row. A row's notes are the exception: what it needs, such as its standing, `new commits since your Review`, `opening…` or `changes requested`, has a line of its own under the others, which wraps between notes and is never cut.
- **Active Change:** a row for the one Change the review window holds, open or not, which the next step resumes, laid out as Waiting on you lays out a pull request: the author's 16px avatar, or an empty circle for a local Change; a muted `acme/web #77 · waiting 2 days · bob`, the wait while the pull request waits on the Reviewer, or `local branch in api`; the title as a link that resumes the Change in the review window, named for screen readers `Resume Retry failed webhooks`; a pull request's size and check status pill; and its standing line as on the overview, with the review mark (`✓ You approved at 14:32 · 4 of 4 viewed`). A row doesn't offer Submit Review… or Write Brief…: finishing belongs to the review, in the review window, and is the next step once every file is viewed. A Change with no files to review isn't a review in progress: it isn't listed, and is never the next step.
- **Waiting on you:** the pull requests that wait on the Reviewer and aren't open as a Change, the longest wait first. One the Reviewer opens moves to Active Change, so each pull request shows once; closing its Change brings it back while it still waits. The wait counts from the review request: a personal one, else a Team request, else the pull request's creation. Each row has a 16px avatar, the tree's icon size, then a muted `acme/billing #19 · waiting 4 days · carol`, so the repository and number never hide behind a long title, and a long login is what's cut short, the title as a link that opens it as a Change, and its size (`31 files · +120 −2204`, the numbers tinted as on the overview), a check status pill, and, on their own line, notes such as `via @acme/api-owners` for a Team request to a team the Reviewer is on (none when it asks the Reviewer personally too), `new commits since your Review` or `opening…`.
- **Ignored:** the pull requests the Reviewer set aside from Waiting on you, in a list under it that shows only while it holds any. It starts collapsed, behind a disclosure titled `Ignored (2)`, and opens to rows laid out as Waiting on you lays them out, each with the wait it had. A Waiting on you row ends in an Ignore link, named for screen readers `Ignore acme/billing #19`, and an Ignored row in a Restore link, which puts the pull request back where its wait places it. An ignored pull request leaves the facts line's count and its oldest wait, and is never the next step. It stays ignored through new commits, a new review request and a reload, until the Reviewer restores it, or it leaves the Inbox, as when it merges or closes or its repository is no longer listed. Only the Reviewer's machine knows: GitHub isn't told. Authored, reviewed and local rows have no Ignore.
- **Your pull requests** and **Reviewed by you:** the same rows without an avatar, author or wait, with the authored states as words, such as `changes requested`.
- **Reviewed by your team:** the pull requests whose Team request a teammate's review answered, in the rows Reviewed by you has. A row says first who reviewed and how, then which team was asked: `Approved by @octocat`, `via @acme/api-owners`. The list shows only while it holds any. Nobody is waiting on the Reviewer for these, so they stay out of Waiting on you and its count. They're read from GitHub on each refresh and remembered nowhere. Only the Reviewer's own Review, which moves one to Reviewed by you, or its merging or closing, takes a pull request off the list. A pull request GitHub's automatic review assignment took from the team isn't listed.
- **Local branches:** the branch name as a link in the editor font, over a muted `all-haste/gm-tools · 3 commits ahead of main`. The first five show, then a Show all link with the count (`Show all 21`, with `aria-expanded`) for the rest.
- **Open a commit range…:** a link at the foot, for any range of a repository, picked from its branches, remote branches and tags.
- **Setup and problems:** signed out, or with no repository, a line under the facts says what to set up, with its first way as the filled button (`Sign In to GitHub`, `Add Repository…`), or, while a next step is already the one filled button, as a secondary one and the others as muted links, such as `Use a Personal Access Token · Set Up Dear Reviewer`. A list that can't load says so in a muted line with the link that helps. Never a red banner.

The Dashboard has no data of its own. It shows the Inbox's pull requests and branches and the overview's standing, from the same load, so the Dashboard and the overview never disagree. Each list is built again only when it changed, so the focus stays put (the Steady Focus Rule), and Show Dashboard puts the focus on the next step.

### Rendered Markdown

The shared reading style for timeline bodies and Assistant replies: tight margins (0.5em between blocks, no margin at the edges), small headings, `code-block` grounds for code, `quote-block` for quotes, hairline table cells, and links in `link` that open through the extension. Fenced code is plain text in the editor font with no syntax highlighting (ADR 0012).

## Do's and Don'ts

### Do:

- **Do** take every color from a `--vscode-*` variable, with a fallback inside `var()` when the theme might not define it, as in `var(--vscode-input-border, transparent)`.
- **Do** reach for native UI first (tree views, comment threads, decorations, quick picks, status bar) and add a webview only when an ADR says why none fits.
- **Do** put styles every webview uses in `sharedStyles` in `extension/src/markdownPanel.ts`, and the overview's page styles (header, buttons, facts line, status pills, rows) in `pageStyles` in `extension/src/timeline/panel.ts`, never a copy in each panel.
- **Do** give every interactive element a visible `:focus-visible` outline in `focus`, and make links in rendered Markdown reachable with Tab and Enter.
- **Do** show loading with VS Code's progress bar, the only motion in Dear Reviewer: 2px of `progressBar-background` sliding along the top, appearing only after 300ms so a quick load doesn't flash. Each webview draws it (`.progress` in `sharedStyles`) along its top edge, right under the view's header: the Dashboard while the Inbox loads, on Refresh too, and the overview while its timeline loads. With reduced motion it holds still across the width, with no animation at all. The muted loading line stays beside it, for screen readers and for a first load with nothing else to show.
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
- **Don't** brand the Assistant beyond its Hand: no avatar, mascot, face, fill, gradient, glow or sparkle motif. Its marks are the reading cat, its name, its rule and its color, and nothing else.
- **Don't** build custom-styled review pages in the manner of the GitHub Pull Requests extension's webviews.
- **Don't** load web fonts or set absolute font sizes.
