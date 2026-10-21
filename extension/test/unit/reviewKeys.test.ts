import * as assert from "assert";
import { reviewKey } from "../../src/reviewKeys";

describe("A review key", () => {
  it("reads in the Mac's notation on a Mac, and as Ctrl+Alt+R elsewhere", () => {
    assert.strictEqual(reviewKey("F", "darwin"), "⌃⌥R F");
    assert.strictEqual(reviewKey("F", "linux"), "Ctrl+Alt+R F");
    assert.strictEqual(reviewKey("Shift+F", "win32"), "Ctrl+Alt+R Shift+F");
  });
});
