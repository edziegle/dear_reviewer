// The styles the webviews share. Kept apart from `vscode` so the unit tests can
// read them under plain Node.

/**
 * The styles the webviews share: rendered Markdown, the problem banner and
 * its button, the Assistant's hand, the message box, the focus outline on
 * every button, link and summary, and the theme's button border, which only
 * high-contrast themes draw (DESIGN.md).
 */
export const sharedStyles = `
  button:focus-visible, a:focus-visible, summary:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  button.primary, button.secondary, button.send, .problem button { border: 1px solid var(--vscode-button-border, var(--vscode-contrastBorder, transparent)); }
  textarea { resize: vertical; min-height: 2.6em; font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; padding: 4px 6px; }
  textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  textarea::placeholder { color: var(--vscode-input-placeholderForeground); opacity: 1; }
  .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .markdown > :first-child { margin-top: 0; }
  .markdown > :last-child { margin-bottom: 0; }
  .markdown h3, .markdown h4, .markdown h5, .markdown h6 { font-size: 1.05em; margin: 1em 0 0.4em; }
  .markdown h3 { font-size: 1.2em; }
  .markdown h4 { font-size: 1.1em; }
  .markdown p, .markdown ul, .markdown ol, .markdown pre, .markdown blockquote, .markdown table { margin: 0.5em 0; }
  .markdown ul, .markdown ol { padding-left: 1.6em; list-style: revert; }
  .markdown code { font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); color: var(--vscode-foreground); background: var(--vscode-textCodeBlock-background); padding: 0 3px; border-radius: 3px; overflow-wrap: anywhere; }
  .markdown pre { background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 3px; overflow-x: auto; }
  .markdown pre code { padding: 0; background: none; white-space: pre; }
  .markdown a code { color: inherit; }
  .markdown blockquote { background: var(--vscode-textBlockQuote-background); padding: 4px 8px; border-radius: 3px; color: var(--vscode-textBlockQuote-foreground, inherit); }
  .markdown table { border-collapse: collapse; }
  .markdown th, .markdown td { border: 1px solid var(--vscode-panel-border); padding: 2px 6px; }
  .markdown a[data-href], .markdown a[data-path] { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
  .markdown a[data-href]:hover, .markdown a[data-path]:hover { color: var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground)); }
  .problem { margin: 12px 0; padding: 8px; border: 1px solid var(--vscode-inputValidation-errorBorder); background: var(--vscode-inputValidation-errorBackground); white-space: pre-wrap; }
  .problem code { font-family: var(--vscode-editor-font-family); }
  .problem button { display: block; margin-top: 8px; padding: 4px 12px; border-radius: 2px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; font: inherit; }
  .problem button:hover { background: var(--vscode-button-hoverBackground); }
  .hand { border-left: 2px solid var(--vscode-dearReviewer-assistantForeground); padding-left: 12px; }
  .speaker { display: flex; flex-wrap: wrap; align-items: center; gap: 0 6px; font-size: 0.9em; font-weight: 600; margin: 0 0 4px; }
  .speaker .cat { width: 1.4em; height: 1.4em; flex: none; color: var(--vscode-dearReviewer-assistantForeground); }
  .progress { position: fixed; top: 0; left: 0; right: 0; height: 2px; overflow: hidden; pointer-events: none; z-index: 2; animation: progress-appear 150ms 300ms both; }
  .progress::before { content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 2%; background: var(--vscode-progressBar-background); animation: progress 4s linear infinite; }
  @keyframes progress-appear { from { opacity: 0; } to { opacity: 1; } }
  @keyframes progress { from { transform: translateX(0) scaleX(1); } 50% { transform: translateX(2500%) scaleX(3); } to { transform: translateX(4900%) scaleX(1); } }
  @media (prefers-reduced-motion: reduce) { .progress::before { width: 100%; opacity: 0.6; animation: none; } }
  .vscode-reduce-motion .progress::before { width: 100%; opacity: 0.6; animation: none; }`;
