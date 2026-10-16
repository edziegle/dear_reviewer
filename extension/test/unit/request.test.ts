import * as assert from "assert";
import * as http from "http";
import { AddressInfo } from "net";
import { isUnreachable } from "../../src/errors";
import { fetchWithin } from "../../src/github/request";

describe("A request to GitHub", () => {
  let server: http.Server;
  let url: string;
  let open: http.ServerResponse[];

  beforeEach(async () => {
    open = [];
    server = http.createServer((req, res) => {
      open.push(res);
      if (req.url === "/never") return;
      if (req.url === "/slow-body") {
        res.writeHead(200);
        res.write("first ");
        setTimeout(() => res.end("last"), 1000);
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    for (const res of open) res.destroy();
    await new Promise((resolve) => server.close(resolve));
  });

  it("gives up on a request that never answers, with an error that says GitHub is unreachable", async () => {
    await assert.rejects(fetchWithin(`${url}/never`, {}, 100), (err) => {
      assert.ok(isUnreachable(err), `${err} is not an unreachable error`);
      return true;
    });
  });

  it("waits as long as a body takes once GitHub has answered", async () => {
    const res = await fetchWithin(`${url}/slow-body`, {}, 500);
    assert.strictEqual(await res.text(), "first last");
  });
});
