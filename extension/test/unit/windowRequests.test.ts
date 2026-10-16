import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  current,
  parseRequests,
  requestLifetime,
  withRequest,
  WindowRequests,
  type WindowRequest,
} from "../../src/windowRequests";

const now = Date.parse("2026-10-15T12:00:00Z");
const request = (more: Partial<WindowRequest> = {}): WindowRequest => ({
  id: "r1",
  change: "c1",
  action: "resume",
  at: now,
  ...more,
});

describe("windowRequests", () => {
  describe("parseRequests", () => {
    it("keeps the well-formed requests and ignores the rest", () => {
      assert.deepStrictEqual(
        parseRequests(
          JSON.stringify([
            request(),
            { id: "r2", change: "c2", action: "delete", at: now },
            { id: "r3", change: 4, action: "finish", at: now },
            null,
          ])
        ),
        [request()]
      );
    });

    it("gives none for a file that isn't a list", () => {
      assert.deepStrictEqual(parseRequests("{"), []);
      assert.deepStrictEqual(parseRequests('{"id":"r1"}'), []);
    });
  });

  describe("current", () => {
    it("drops a request once its lifetime has passed, and one from the future", () => {
      const fresh = request({ id: "fresh", at: now - requestLifetime + 1 });
      const stale = request({ id: "stale", at: now - requestLifetime });
      const future = request({ id: "future", at: now + 1 });
      assert.deepStrictEqual(current([fresh, stale, future], now), [fresh]);
    });
  });

  describe("withRequest", () => {
    it("replaces an earlier request for the same Change, keeping the others", () => {
      const other = request({ id: "r0", change: "c0", at: now - 1000 });
      const earlier = request({ id: "r1", at: now - 500 });
      const later = request({ id: "r2", action: "finish" });
      assert.deepStrictEqual(withRequest([other, earlier], later, now), [
        other,
        later,
      ]);
    });
  });

  describe("WindowRequests", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "window-requests-"));
    after(() => fs.rmSync(dir, { recursive: true, force: true }));

    it("keeps a request for the review window until it's done", () => {
      const requests = new WindowRequests(dir);
      assert.deepStrictEqual(requests.all(now), []);
      const resume = requests.ask("c1", "resume", now);
      const finish = requests.ask("c2", "finish", now + 1);
      assert.deepStrictEqual(requests.all(now + 2), [resume, finish]);
      requests.done(new Set([resume.id]), now + 2);
      assert.deepStrictEqual(requests.all(now + 2), [finish]);
      assert.deepStrictEqual(
        requests.all(now + 1 + requestLifetime),
        [],
        "too old to carry out"
      );
    });
  });
});
