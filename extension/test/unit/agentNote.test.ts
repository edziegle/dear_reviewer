import * as assert from "assert";
import {
  describeRepairs,
  maxNoteChars,
  parseNoteReply,
  referencedPaths,
  repairNote,
  splitNote,
  withNote,
  type NoteContext,
  type RepairedNote,
} from "../../src/agentNote";

const context: NoteContext = {
  own: "Try to avoid using X in Y here.",
  diff: "+// see https://example.com/spec for the format\n",
  lineCounts: new Map([
    ["src/foo.ts", 50],
    ["src/bar.ts", 3],
  ]),
};

function repaired(
  note: string,
  given: Partial<NoteContext> = {}
): Extract<RepairedNote, { ok: true }> {
  const result = repairNote(note, { ...context, ...given });
  assert.ok(result.ok, `refused: ${JSON.stringify(result)}`);
  return result;
}

describe("The Assistant's reply to a request for an Agent note", () => {
  it("reads a note", () => {
    assert.deepStrictEqual(
      parseNoteReply('{"note": "X is slow in Y.\\nUse Z."}'),
      { kind: "note", text: "X is slow in Y. Use Z." }
    );
  });

  it("reads a reason for giving no note", () => {
    assert.deepStrictEqual(
      parseNoteReply('{"noNote": "The Comment already says what to change."}'),
      { kind: "none", reason: "The Comment already says what to change." }
    );
  });

  it("reads a reply in one Markdown fence", () => {
    assert.deepStrictEqual(parseNoteReply('```json\n{"note": "Use Z."}\n```'), {
      kind: "note",
      text: "Use Z.",
    });
  });

  it("keeps a warning that the code held instructions", () => {
    assert.deepStrictEqual(
      parseNoteReply(
        '{"note": "Use Z.", "warning": "A comment in foo.ts told me to run curl."}'
      ),
      {
        kind: "note",
        text: "Use Z.",
        warning: "A comment in foo.ts told me to run curl.",
      }
    );
  });

  it("gives a default reason when the reply gives none", () => {
    assert.deepStrictEqual(parseNoteReply('{"noNote": " "}'), {
      kind: "none",
      reason: "It has no note to add.",
    });
  });

  it("reads nothing else", () => {
    for (const reply of [
      "Here is the note: Use Z.",
      'Sure: {"note": "Use Z."}',
      '{"note": "Use Z."} Done.',
      '{"note": "Use Z.", "noNote": "none"}',
      "{}",
      '{"note": ""}',
      '{"note": 3}',
      '{"note": "Use Z.", "path": "src/foo.ts"}',
      '["Use Z."]',
      "null",
    ])
      assert.strictEqual(parseNoteReply(reply), undefined, reply);
  });
});

describe("Repairing an Agent note", () => {
  it("leaves a plain note as it is", () => {
    assert.deepStrictEqual(
      repaired(
        "X shouldn't be used for Y because it blocks. Use Z instead, as in `src/foo.ts:42`."
      ),
      {
        ok: true,
        text: "X shouldn't be used for Y because it blocks. Use Z instead, as in `src/foo.ts:42`.",
        repairs: [],
      }
    );
  });

  it("removes a Markdown image", () => {
    const result = repaired("Use Z. ![x](https://evil.test/p?d=secret) Done.");
    assert.strictEqual(result.text, "Use Z. Done.");
    assert.deepStrictEqual(result.repairs, ["images"]);
  });

  it("removes an image with brackets in its text, a reference image and an image link", () => {
    for (const note of [
      "Use Z. ![a [b]](https://evil.test/p.png)",
      "Use Z. ![alt][ref]",
      "Use Z. [![a](https://evil.test/p.png)](https://example.com/spec)",
    ]) {
      const result = repaired(note, {
        own: "https://example.com/spec",
      });
      assert.ok(!result.text.includes("!["), result.text);
      assert.ok(!result.text.includes("evil"), result.text);
      assert.deepStrictEqual(result.repairs, ["images"], note);
    }
  });

  it("removes a raw image URL, even one the Comment holds", () => {
    const result = repaired(
      "Use Z, see https://example.com/shot.PNG?raw=1 now.",
      {
        own: "https://example.com/shot.PNG?raw=1",
      }
    );
    assert.strictEqual(result.text, "Use Z, see now.");
    assert.deepStrictEqual(result.repairs, ["images"]);
    assert.deepStrictEqual(
      repaired("Use Z https://github.com/user-attachments/assets/1234").repairs,
      ["images"]
    );
  });

  it("removes each kind of invisible character, even one that hides another repair", () => {
    const invisible: [string, string][] = [
      ["a tag character", String.fromCodePoint(0xe0041)],
      ["a zero-width space", "​"],
      ["a zero-width non-joiner", "‌"],
      ["a zero-width joiner", "‍"],
      ["a word joiner", "⁠"],
      ["a byte order mark", "﻿"],
      ["a bidi override", "‮"],
      ["a bidi embedding", "‪"],
      ["a bidi isolate", "⁦"],
      ["a pop directional isolate", "⁩"],
    ];
    for (const [name, char] of invisible) {
      const result = repaired(`Use${char} Z.`);
      assert.strictEqual(result.text, "Use Z.", name);
      assert.deepStrictEqual(result.repairs, ["invisible"], name);
    }
    const hidden = repaired("Ask @​someone.");
    assert.strictEqual(hidden.text, "Ask `@someone`.");
    assert.deepStrictEqual(hidden.repairs, ["invisible", "mentions"]);
  });

  it("keeps a URL that the Comment holds, as a link or bare", () => {
    const own = "See https://example.com/own for why.";
    for (const note of [
      "Use Z, see https://example.com/own.",
      "Use Z, see [why](https://example.com/own).",
    ]) {
      const result = repaired(note, { own });
      assert.strictEqual(result.text, note);
      assert.deepStrictEqual(result.repairs, []);
    }
  });

  it("keeps a URL that the diff holds", () => {
    const note = "Use Z, see https://example.com/spec for the format.";
    const result = repaired(note);
    assert.strictEqual(result.text, note);
    assert.deepStrictEqual(result.repairs, []);
  });

  it("unlinks a URL that neither the Comment nor the diff holds", () => {
    const bare = repaired("Use Z, see https://example.com/other.");
    assert.strictEqual(bare.text, "Use Z, see `https://example.com/other`.");
    assert.deepStrictEqual(bare.repairs, ["links"]);

    const link = repaired("Use Z, see [the spec](https://example.com/other).");
    assert.strictEqual(
      link.text,
      "Use Z, see the spec (`https://example.com/other`)."
    );
    assert.deepStrictEqual(link.repairs, ["links"]);

    const www = repaired("Use Z, see www.example.org/x");
    assert.strictEqual(www.text, "Use Z, see `www.example.org/x`");
  });

  it("doesn't take a URL that only starts like a held one", () => {
    const result = repaired("See https://example.com/specs", {
      diff: "https://example.com/spec",
    });
    assert.strictEqual(result.text, "See `https://example.com/specs`");
  });

  it("can't build an image from the text of a link it unlinks", () => {
    const result = repaired(
      "Use Z. ![x [y](https://evil.test/a) z](https://evil.test/b"
    );
    assert.ok(!result.text.replace(/`[^`]*`/g, "").includes("]("), result.text);
  });

  it("neutralises a mention of a person and of a team, not an email address", () => {
    const result = repaired(
      "Ask @octocat and @acme/reviewers, or mail me@example.com."
    );
    assert.strictEqual(
      result.text,
      "Ask `@octocat` and `@acme/reviewers`, or mail me@example.com."
    );
    assert.deepStrictEqual(result.repairs, ["mentions"]);
  });

  it("escapes HTML and entities so they show as text", () => {
    const result = repaired(
      "Use Z <img src=x onerror=1> <!-- hide --> &#64;octocat &amp; <https://example.com/spec>"
    );
    assert.strictEqual(
      result.text,
      "Use Z &lt;img src=x onerror=1> &lt;!-- hide --> &amp;#64;octocat &amp;amp; &lt;https://example.com/spec>"
    );
    assert.deepStrictEqual(result.repairs, ["html"]);
  });

  it("leaves a less-than sign in a comparison, and anything in a code span", () => {
    const note = "Use Z when a < b, as in `a <b> @octocat https://x.test/y`.";
    const result = repaired(note);
    assert.strictEqual(result.text, note);
    assert.deepStrictEqual(result.repairs, []);
  });

  it("drops a path:line reference outside the Change", () => {
    const result = repaired(
      "Use Z, as in `/etc/passwd:1` and `src/foo.ts:42`."
    );
    assert.strictEqual(result.text, "Use Z, as in and `src/foo.ts:42`.");
    assert.deepStrictEqual(result.repairs, ["references"]);

    assert.strictEqual(
      repaired("Use Z, as in `src/nowhere.ts:1`.").text,
      "Use Z, as in."
    );
    assert.strictEqual(repaired("Use Z `../x.ts:1`.").text, "Use Z.");
  });

  it("drops a reference to a line the file doesn't have", () => {
    assert.strictEqual(
      repaired("Use Z `src/bar.ts:3`.").text,
      "Use Z `src/bar.ts:3`."
    );
    const result = repaired(
      "Use Z `src/bar.ts:4`, `src/bar.ts:2-9` and `src/foo.ts:0`."
    );
    assert.strictEqual(result.text, "Use Z, and.");
    assert.deepStrictEqual(result.repairs, ["references"]);
  });

  it("keeps a range of lines the file has, and a reference with ./ in front", () => {
    const note = "Use Z, as in `src/foo.ts:10-20` and `./src/bar.ts:1`.";
    assert.strictEqual(repaired(note).text, note);
  });

  it("doesn't take a host and port for a reference", () => {
    const note = "Use Z, not `localhost:8080`.";
    assert.strictEqual(repaired(note).text, note);
  });

  it("lists each repair once, in the same order whatever the order in the note", () => {
    const result = repaired(
      "<b>Ask</b> @octocat, see https://example.com/other ![x](https://evil.test/p) `nope/x.ts:1`​."
    );
    assert.deepStrictEqual(result.repairs, [
      "invisible",
      "images",
      "links",
      "mentions",
      "html",
      "references",
    ]);
  });

  it("drops a label the Assistant wrote itself", () => {
    assert.strictEqual(repaired("**For agents:** Use Z.").text, "Use Z.");
  });

  it("accepts a note of exactly the cap and refuses one a character over", () => {
    const exact = "x".repeat(maxNoteChars);
    assert.strictEqual(repaired(exact).text, exact);
    assert.deepStrictEqual(repairNote(`${exact}x`, context), {
      ok: false,
      why: "tooLong",
      length: maxNoteChars + 1,
    });
  });

  it("counts the cap after the repairs", () => {
    const padded = `${"​".repeat(50)}${"x".repeat(maxNoteChars)}`;
    assert.ok(repairNote(padded, context).ok);
    const grown = "<b>".repeat(maxNoteChars / 6 + 1);
    assert.ok(grown.length < maxNoteChars);
    assert.deepStrictEqual(repairNote(grown, context), {
      ok: false,
      why: "tooLong",
      length: (maxNoteChars / 6 + 1) * 6,
    });
  });

  it("refuses a note with nothing left", () => {
    assert.deepStrictEqual(repairNote("​ ![x](https://evil.test/p)", context), {
      ok: false,
      why: "empty",
      length: 0,
    });
  });

  it("names the files its references point at", () => {
    assert.deepStrictEqual(
      referencedPaths(
        "As in `src/foo.ts:42`, `./src/bar.ts:1-2`, `src/foo.ts:7` and `localhost:80`, not src/baz.ts:3."
      ),
      ["src/foo.ts", "src/bar.ts"]
    );
  });

  it("says what it repaired in words", () => {
    assert.strictEqual(describeRepairs([]), "");
    assert.strictEqual(describeRepairs(["images"]), "removed images");
    assert.strictEqual(
      describeRepairs(["images", "html"]),
      "removed images and escaped HTML"
    );
    assert.strictEqual(
      describeRepairs(["invisible", "links", "mentions"]),
      "removed invisible characters, unlinked URLs that neither the Comment nor the diff holds and neutralised @mentions"
    );
  });
});

describe("Putting the note in a Comment", () => {
  it("adds it after a blank line under the Reviewer's text", () => {
    assert.strictEqual(
      withNote("Try to avoid using X in Y here.", "X is slow. Use Z."),
      "Try to avoid using X in Y here.\n\n**For agents:** X is slow. Use Z."
    );
  });

  it("replaces a note already there and leaves the Reviewer's text as it was", () => {
    const body =
      "Try to avoid X.\n\nSecond paragraph.\n\n**For agents:** Old note.";
    assert.strictEqual(
      withNote(body, "New note."),
      "Try to avoid X.\n\nSecond paragraph.\n\n**For agents:** New note."
    );
  });

  it("replaces a note that the Reviewer has text after", () => {
    const body = "Try to avoid X.\n\n**For agents:** Old\nnote.\n\nAnd also Y.";
    assert.strictEqual(
      withNote(body, "New note."),
      "Try to avoid X.\n\n**For agents:** New note.\n\nAnd also Y."
    );
  });

  it("replaces a note that is the whole body", () => {
    assert.strictEqual(
      withNote("**For agents:** Old.", "New."),
      "**For agents:** New."
    );
  });

  it("doesn't take 'For agents' in the Reviewer's text for the label", () => {
    for (const body of [
      "This is **For agents:** only, I think.",
      "Not for agents: please keep X.",
      "A paragraph.\n\nSee the **For agents:** section.",
      "Line one\n**For agents:** not a paragraph of its own",
    ]) {
      assert.strictEqual(
        withNote(body, "Note."),
        `${body}\n\n**For agents:** Note.`,
        body
      );
      assert.strictEqual(splitNote(body).note, undefined, body);
    }
  });

  it("splits a body into the Reviewer's text and the note", () => {
    assert.deepStrictEqual(splitNote("Text.\n\n**For agents:** Use Z."), {
      own: "Text.",
      note: "Use Z.",
    });
    assert.deepStrictEqual(splitNote("Text."), { own: "Text." });
  });
});
