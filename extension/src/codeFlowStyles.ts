// The Code Flow tab's own styles, after the ones the webviews share. Kept
// apart from `vscode` so the unit tests can read them under plain Node.

/**
 * The Code Flow tab's styles: the toolbar of toggles, the notices and the line
 * that says what the picture leaves out, the call map and swimlanes drawn in
 * the theme's git colors, the details of the selected symbol, the list and the
 * walkthrough. High-contrast themes leave the list's selection colors unset
 * and mark a selection with an outline instead, so every selection color here
 * falls back, and the selection draws the theme's outline where it has one.
 */
export const codeFlowStyles = `
  body { margin: 0; padding: 0 16px 16px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); line-height: 1.5; }
  .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin: 0 0 6px; padding: 10px 0 6px; position: sticky; top: 0; z-index: 1; background: var(--vscode-editor-background); overflow: clip; overflow-clip-margin: 4px; }
  /* A group, and a row of toggles, wrap only when a narrow tab has no room for them on one line. */
  .group { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
  /* Show tests and Show removed choose what the picture takes in, apart from the hops beside them: a hairline in the gap before them, which the toolbar clips where they start a line. */
  .toggles { position: relative; }
  .toggles::before { content: ""; position: absolute; left: -9px; top: 2px; bottom: 2px; border-left: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder, transparent)); }
  .seg { display: inline-flex; flex-wrap: wrap; }
  /* Toggles as the editor draws its own, such as those of the find bar: a tint and a border when on, never a filled button. */
  .seg button { font: inherit; white-space: nowrap; padding: 1px 10px; color: var(--vscode-foreground); background: transparent; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border, var(--vscode-contrastBorder, transparent))); cursor: pointer; }
  .seg button + button { margin-left: -1px; }
  .seg button:hover { background: var(--vscode-toolbar-hoverBackground); }
  .seg button:first-child { border-radius: 2px 0 0 2px; }
  .seg button:last-child { border-radius: 0 2px 2px 0; }
  .seg button:only-child { border-radius: 2px; }
  .seg button[aria-pressed=true] { position: relative; color: var(--vscode-inputOption-activeForeground, var(--vscode-foreground)); background: var(--vscode-inputOption-activeBackground); border-color: var(--vscode-inputOption-activeBorder, var(--vscode-focusBorder)); }
  .seg button:focus-visible { position: relative; z-index: 1; }
  .seg button::before { content: "\\2713\\00a0"; content: "\\2713\\00a0" / ""; visibility: hidden; }
  .seg button[aria-pressed=true]::before { visibility: visible; }
  select { font: inherit; color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); border: 1px solid var(--vscode-dropdown-border, var(--vscode-contrastBorder, transparent)); padding: 1px 4px; }
  select:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .legend { display: inline-flex; gap: 12px; color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  .legend .key { display: inline-block; width: 1.6em; height: 0.9em; vertical-align: middle; margin-right: 4px; background: var(--vscode-editor-background); box-sizing: border-box; }
  .key.changed { border: 2px solid var(--vscode-gitDecoration-modifiedResourceForeground, var(--vscode-focusBorder)); }
  .key.new { border: 2px dashed var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-focusBorder)); }
  .key.removed { border: 2px dotted var(--vscode-gitDecoration-deletedResourceForeground, var(--vscode-focusBorder)); }
  .key.unchanged { border: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder)); }
  .notice { margin: 8px 0; padding: 8px; border: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder)); background: var(--vscode-textBlockQuote-background); }
  .notice.problem { border-color: var(--vscode-inputValidation-errorBorder); background: var(--vscode-inputValidation-errorBackground); }
  .notice button { margin-left: 8px; font: inherit; padding: 1px 10px; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: 1px solid var(--vscode-button-border, var(--vscode-contrastBorder, transparent)); border-radius: 2px; cursor: pointer; }
  .notice button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  /* What fixes a problem is the one filled button. */
  .notice.problem button { margin-left: 0; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  .notice.problem button:hover { background: var(--vscode-button-hoverBackground); }
  .meta { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 16px; margin: 0 0 6px; color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  .meta .left-out { flex: 1 1 auto; min-width: 0; margin: 0; }
  .meta .keys { margin-left: auto; }
  button.link { font: inherit; padding: 0; border: none; background: none; color: var(--vscode-textLink-foreground); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
  button.link:hover { color: var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground)); }
  .canvas { overflow: auto; max-height: max(240px, calc(100vh - 160px)); border: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder)); background: var(--vscode-editor-background); }
  .canvas svg { display: block; }
  /* Where texts are measured before the picture is laid out. */
  .probe { position: absolute; width: 0; height: 0; overflow: hidden; visibility: hidden; }
  .node .box { fill: var(--vscode-editor-background); stroke: var(--vscode-descriptionForeground); stroke-width: 1; }
  .node.changed .box { stroke: var(--vscode-gitDecoration-modifiedResourceForeground, var(--vscode-focusBorder)); stroke-width: 2.5; }
  .node.new .box { stroke: var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-focusBorder)); stroke-width: 2.5; stroke-dasharray: 10 5; }
  .node.removed .box { stroke: var(--vscode-gitDecoration-deletedResourceForeground, var(--vscode-focusBorder)); stroke-width: 3; stroke-dasharray: 0.1 5; stroke-linecap: round; }
  .node[aria-selected=true] .box { fill: var(--vscode-list-activeSelectionBackground, transparent); }
  .node[aria-selected=true] text { fill: var(--vscode-list-activeSelectionForeground, var(--vscode-editor-foreground)); }
  .call[aria-selected=true] .hit { stroke-dasharray: none; }
  /* The rings go around the box, so the box keeps the stroke and dash that mark its status: dashed where a high-contrast theme marks the selection, solid for the focus. */
  .node .ring { fill: none; stroke: none; }
  .node[aria-selected=true] .ring { stroke: var(--vscode-contrastActiveBorder, transparent); stroke-width: 1; stroke-dasharray: 4 3; }
  .node:focus { outline: none; }
  .node:focus-visible .ring { stroke: var(--vscode-focusBorder); stroke-width: 2; stroke-dasharray: none; }
  .call:focus-visible .hit { stroke: var(--vscode-focusBorder); stroke-width: 3; }
  .node text, .lane text, .call text { fill: var(--vscode-editor-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
  .node .name { font-family: var(--vscode-editor-font-family); font-weight: 600; }
  /* A symbol's name shows it in the diff; the rest of its box only selects it. */
  .node .name, .call .name { cursor: pointer; }
  .node .name:hover, .call .name:hover { text-decoration: underline; }
  .node .where { fill: var(--vscode-descriptionForeground); font-size: calc(var(--vscode-font-size) * 0.9); }
  /* A call's label, only ever on the selected symbol's calls: in the foreground, knocked out of the calls that cross it. */
  .edge-label { fill: var(--vscode-editor-foreground); font-size: calc(var(--vscode-font-size) * 0.9); paint-order: stroke; stroke: var(--vscode-editor-background); stroke-width: 4px; stroke-linejoin: round; }
  .node.unchanged .name { font-weight: 400; }
  .edge { fill: none; stroke: var(--vscode-descriptionForeground); stroke-width: 1.2; }
  .arrow { fill: var(--vscode-descriptionForeground); }
  .arrow.changed { fill: var(--vscode-gitDecoration-modifiedResourceForeground, var(--vscode-focusBorder)); }
  .arrow.new { fill: var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-focusBorder)); }
  .arrow.removed { fill: var(--vscode-gitDecoration-deletedResourceForeground, var(--vscode-focusBorder)); }
  /* The selected symbol's calls, in and out, in the focus color that marks what the Reviewer is on. */
  .selected-call .edge { stroke: var(--vscode-focusBorder); stroke-width: 2; }
  .arrow.selected { fill: var(--vscode-focusBorder); }
  .lane-head { font-weight: 600; }
  .lane-line { stroke: var(--vscode-panel-border, var(--vscode-descriptionForeground)); stroke-dasharray: 3 4; }
  .call.changed .edge { stroke: var(--vscode-gitDecoration-modifiedResourceForeground, var(--vscode-focusBorder)); stroke-width: 2.5; }
  .call.new .edge { stroke: var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-focusBorder)); stroke-width: 2.5; stroke-dasharray: 10 5; }
  .call.removed .edge { stroke: var(--vscode-gitDecoration-deletedResourceForeground, var(--vscode-focusBorder)); stroke-width: 3; stroke-dasharray: 0.1 5; stroke-linecap: round; }
  .call .where { fill: var(--vscode-descriptionForeground); font-size: calc(var(--vscode-font-size) * 0.9); }
  .call .hit { fill: transparent; stroke: transparent; }
  .call:hover .hit { fill: var(--vscode-list-hoverBackground); }
  .call[aria-selected=true] .hit { fill: var(--vscode-list-activeSelectionBackground, transparent); stroke: var(--vscode-contrastActiveBorder, var(--vscode-list-activeSelectionForeground, var(--vscode-focusBorder))); }
  .call[aria-selected=true] text, .call[aria-selected=true] .where { fill: var(--vscode-list-activeSelectionForeground, var(--vscode-editor-foreground)); }
  .details { position: sticky; bottom: 0; background: var(--vscode-editor-background); margin: 10px 0 0; padding: 8px; border: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder)); min-height: 3em; }
  .details .where, .list .where { font-family: var(--vscode-editor-font-family); color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; }
  .details button { margin-top: 6px; font: inherit; padding: 2px 12px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 1px solid var(--vscode-button-border, var(--vscode-contrastBorder, transparent)); border-radius: 2px; cursor: pointer; }
  .details button:hover { background: var(--vscode-button-hoverBackground); }
  .details button.secondary { padding: 2px 8px; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  .details button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .details .actions { display: flex; flex-wrap: wrap; gap: 6px 8px; margin-top: 6px; }
  .details .actions button { margin-top: 0; }
  .list { margin: 0; padding-left: 1.2em; }
  .list li { margin: 6px 0; }
  .walkthrough, .walkthrough ol { list-style: none; margin: 0; padding-left: 0; }
  .walkthrough ol { padding-left: 1.6em; }
  .walkthrough li { margin: 8px 0; }
  .walkthrough .num { font-variant-numeric: tabular-nums; color: var(--vscode-descriptionForeground); }
  .walkthrough .detail { margin-left: 2.2em; color: var(--vscode-descriptionForeground); }
  .walkthrough .note { margin-left: 2.2em; }
  .hint { margin: 0 0 6px; color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  .neighbours { margin-top: 6px; }
  .neighbours button.sym, .list button.sym, .walkthrough button.sym { font: inherit; font-family: var(--vscode-editor-font-family); background: none; border: none; color: var(--vscode-textLink-foreground); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; padding: 0; }
  .badge { font-size: 0.85em; margin-left: 6px; padding: 0 6px; border-radius: 8px; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); }
  .empty { color: var(--vscode-descriptionForeground); margin: 14px 0; }
  /* Ink that runs once along a call, from caller to callee; hidden unless it is running. */
  .trace { fill: none; stroke: var(--vscode-editor-foreground); stroke-width: 2; stroke-linecap: round; stroke-dasharray: 1 1; opacity: 0; pointer-events: none; }
  .ghost { pointer-events: none; }`;
