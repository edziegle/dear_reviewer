import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

const extensionDir = path.join(__dirname, "../../../..");

interface Manifest {
  contributes: {
    commands: { command: string; title: string }[];
    keybindings: { command: string; key: string }[];
    walkthroughs: {
      id: string;
      steps: {
        id: string;
        description: string;
        media: {
          image?: Record<string, string>;
          markdown?: string;
        };
        completionEvents?: string[];
      }[];
    }[];
  };
}

const manifest = JSON.parse(
  fs.readFileSync(path.join(extensionDir, "package.json"), "utf8")
) as Manifest;
const { commands, keybindings, walkthroughs } = manifest.contributes;
const ours = new Set(commands.map((c) => c.command));
/** The editor's own commands that a step may link to. */
const workbench = new Set(["workbench.action.openSettings"]);

describe("The walkthroughs", () => {
  for (const walkthrough of walkthroughs)
    for (const step of walkthrough.steps) {
      const name = `${walkthrough.id}/${step.id}`;

      it(`${name} links only to commands that exist`, () => {
        for (const [, id] of step.description.matchAll(
          /\(command:([\w.]+)/g
        ))
          assert.ok(ours.has(id) || workbench.has(id), `${name} links to ${id}`);
        for (const event of step.completionEvents ?? []) {
          const command = /^onCommand:(.+)$/.exec(event)?.[1];
          if (command) assert.ok(ours.has(command), `${name} waits for ${command}`);
        }
      });

      it(`${name} shows media that exists`, () => {
        const files = [
          ...Object.values(step.media.image ?? {}),
          ...(step.media.markdown ? [step.media.markdown] : []),
        ];
        assert.ok(files.length > 0, `${name} has media`);
        for (const file of files)
          assert.ok(
            fs.existsSync(path.join(extensionDir, file)),
            `${name} shows ${file}`
          );
      });
    }

  it("lists every review key, by the title the palette gives its command", () => {
    const keys = fs.readFileSync(
      path.join(extensionDir, "media/walkthrough/keys.md"),
      "utf8"
    );
    for (const { command, key } of keybindings) {
      const title = commands.find((c) => c.command === command)?.title;
      // As `ctrl+alt+r shift+f` reads in the page: `Ctrl+Alt+R Shift+F`.
      const shown = key
        .replace("ctrl+alt+r", "Ctrl+Alt+R")
        .replace(
          / (shift\+)?(\w)$/,
          (_, shift, letter: string) =>
            ` ${shift ? "Shift+" : ""}${letter.toUpperCase()}`
        );
      assert.ok(
        keys.includes(`| ${shown} | ${title}`),
        `${shown} | ${title} in keys.md`
      );
    }
  });
});
