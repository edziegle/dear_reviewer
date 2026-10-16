// Renders Markdown from GitHub and the Assistant into HTML a webview can
// show safely (ADR 0011): raw HTML is dropped, the result is sanitised to
// a short list of tags, images become links, and links carry their URL in
// `data-href` rather than `href`, so the webview can only ask the extension to
// open them.

import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";

export interface RenderedMarkdown {
  html: string;
  /** The http and https URLs the HTML links to, which the panel may open. */
  links: string[];
}

export interface RenderOptions {
  /**
   * Turn `path:line` and `path:start-end` into references to open: all of
   * them, or those whose path this accepts, such as the Change's files.
   */
  references?: boolean | ((path: string) => boolean);
}

type Token = MarkdownIt.Token;

interface RenderEnv {
  links: string[];
  /** Which paths become references; none without it. */
  references?: (path: string) => boolean;
}

// Raw HTML is parsed only so that it can be dropped: its tags never reach the
// output, and only the text between them stays, as GitHub shows it.
const md = new MarkdownIt({ html: true, linkify: true });
const textOnly: sanitizeHtml.IOptions = {
  allowedTags: [],
  allowedAttributes: {},
};
// The panels' own headings are h1 and h2, so Markdown's headings sit two
// levels below them, and a description's "# Title" doesn't outrank the page.
md.core.ruler.push("headings_below_the_page", (state) => {
  for (const token of state.tokens)
    if (token.type === "heading_open" || token.type === "heading_close")
      token.tag = `h${Math.min(Number(token.tag.slice(1)) + 2, 6)}`;
});
md.renderer.rules.html_block = (tokens, i) =>
  sanitizeHtml(tokens[i].content, textOnly);
md.renderer.rules.html_inline = (tokens, i) =>
  sanitizeHtml(tokens[i].content, textOnly);

/**
 * A file and line, or range, as the Assistant writes them: a path with a
 * folder or an extension, such as `src/app.py:12` or `README.md:3-9`.
 */
const reference =
  /(?<![\w./@+~-])((?:\.{0,2}\/)?(?:[\w.@+~-]+\/)*[\w@+~-][\w.@+~-]*):(\d+)(?:[-–](\d+))?(?![\w-])/g;

export interface FileReference {
  path: string;
  startLine: number;
  endLine: number;
}

/** The references in the text, with where each starts and ends. */
export function findReferences(
  text: string
): (FileReference & { index: number; length: number })[] {
  const found = [];
  for (const match of text.matchAll(reference)) {
    const [whole, file, start, end] = match;
    if (!file.includes("/") && !file.slice(1).includes(".")) continue;
    const startLine = Number(start);
    const endLine = end ? Number(end) : startLine;
    if (startLine < 1 || endLine < startLine) continue;
    found.push({
      path: file,
      startLine,
      endLine,
      index: match.index,
      length: whole.length,
    });
  }
  return found;
}

function referenceOpen(state: MarkdownIt.StateCore, ref: FileReference) {
  const token = new state.Token("file_reference_open", "a", 1);
  token.attrs = [
    ["data-path", ref.path],
    ["data-start", String(ref.startLine)],
    ["data-end", String(ref.endLine)],
  ];
  return token;
}

md.core.ruler.push("file_references", (state) => {
  const accepts = (state.env as unknown as RenderEnv).references;
  if (!accepts) return;
  const referencesIn = (text: string) =>
    findReferences(text).filter((ref) => accepts(ref.path));
  for (const block of state.tokens) {
    if (block.type !== "inline" || !block.children) continue;
    const children: Token[] = [];
    let inLink = 0;
    for (const token of block.children) {
      if (token.type === "link_open") inLink++;
      if (token.type === "link_close") inLink--;
      if (inLink > 0) {
        children.push(token);
      } else if (token.type === "code_inline") {
        const [ref] = referencesIn(token.content);
        if (ref && ref.index === 0 && ref.length === token.content.length) {
          children.push(
            referenceOpen(state, ref),
            token,
            new state.Token("file_reference_close", "a", -1)
          );
        } else children.push(token);
      } else if (token.type === "text") {
        let at = 0;
        for (const ref of referencesIn(token.content)) {
          if (ref.index > at) {
            const before = new state.Token("text", "", 0);
            before.content = token.content.slice(at, ref.index);
            children.push(before);
          }
          const text = new state.Token("text", "", 0);
          text.content = token.content.slice(ref.index, ref.index + ref.length);
          children.push(
            referenceOpen(state, ref),
            text,
            new state.Token("file_reference_close", "a", -1)
          );
          at = ref.index + ref.length;
        }
        if (at === 0) children.push(token);
        else if (at < token.content.length) {
          const after = new state.Token("text", "", 0);
          after.content = token.content.slice(at);
          children.push(after);
        }
      } else children.push(token);
    }
    block.children = children;
  }
});

const renderToken = md.renderer.renderToken.bind(md.renderer);
md.renderer.rules.file_reference_open = (tokens, i) =>
  renderToken(tokens, i, md.options);
md.renderer.rules.file_reference_close = () => "</a>";

/** Only web links can be opened; any other link shows as its text. */
function webLink(url: string | number | null): string | undefined {
  return typeof url === "string" && /^https?:\/\//i.test(url) ? url : undefined;
}

function linksOf(env: unknown): string[] {
  return (env as RenderEnv).links;
}

md.renderer.rules.link_open = (tokens, i, _options, env) => {
  const url = webLink(tokens[i].attrGet("href"));
  if (!url) return "<a>";
  linksOf(env).push(url);
  return `<a data-href="${md.utils.escapeHtml(url)}">`;
};

// An image would load from wherever it is; show a link to it instead.
md.renderer.rules.image = (tokens, i, _options, env) => {
  const token = tokens[i];
  const alt = token.children?.map((child) => child.content).join("") || "image";
  const url = webLink(token.attrGet("src"));
  if (!url) return md.utils.escapeHtml(alt);
  linksOf(env).push(url);
  return `<a data-href="${md.utils.escapeHtml(url)}">${md.utils.escapeHtml(alt)}</a>`;
};

const allowed: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "hr",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "strong",
    "em",
    "s",
    "del",
    "code",
    "pre",
    "blockquote",
    "ul",
    "ol",
    "li",
    "a",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
  ],
  allowedAttributes: {
    a: ["data-href", "data-path", "data-start", "data-end"],
    ol: ["start"],
  },
  allowedSchemes: [],
  disallowedTagsMode: "discard",
};

export function renderMarkdown(
  text: string,
  options: RenderOptions = {}
): RenderedMarkdown {
  const { references } = options;
  const env: RenderEnv = {
    links: [],
    references:
      typeof references === "function"
        ? references
        : references
          ? () => true
          : undefined,
  };
  const html = sanitizeHtml(
    md.render(text, env as unknown as MarkdownIt.Env),
    allowed
  );
  return { html, links: [...new Set(env.links)] };
}
