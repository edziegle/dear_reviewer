// A fake GitHub API on localhost for the tests. It serves pull requests from
// fixtures through the GraphQL `search` the Inbox uses, serves avatars, and
// records every request it receives.
//
// Tests control it over HTTP:
//   PUT /_fake/state     replaces the fixtures and clears the recorded requests
//   GET /_fake/requests  returns the recorded requests

import * as http from "http";
import { AddressInfo } from "net";
import * as zlib from "zlib";

export type CheckState =
  "SUCCESS" | "FAILURE" | "ERROR" | "PENDING" | "EXPECTED";

export interface FakePullRequest {
  /** owner/name */
  repository: string;
  number: number;
  title: string;
  /** The author's login. */
  author: string;
  state?: "OPEN" | "CLOSED" | "MERGED";
  /** Logins whose review is requested. */
  reviewRequested?: string[];
  /** The latest commit's combined check status; absent when it has no checks. */
  checks?: CheckState;
  headRefName?: string;
  baseRefName?: string;
  updatedAt?: string;
}

export interface FakeGitHubState {
  /** The signed-in user, and the token that authenticates as them. */
  viewer: { login: string; token: string };
  pullRequests: FakePullRequest[];
  /**
   * Where avatar URLs point, such as `http://localhost:<port>` to put them on
   * another origin than the API. Defaults to the server's own URL.
   */
  avatarOrigin?: string;
}

export interface RecordedRequest {
  method: string;
  /** The Host header, which tells apart origins that reach this server. */
  host?: string;
  path: string;
  authorization?: string;
  body?: unknown;
}

export async function startFakeGitHub(): Promise<{
  url: string;
  close(): Promise<void>;
}> {
  let state: FakeGitHubState = {
    viewer: { login: "reviewer", token: "" },
    pullRequests: [],
  };
  let requests: RecordedRequest[] = [];

  const server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    const path = req.url ?? "/";
    const send = (status: number, value: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };

    if (path === "/_fake/state" && req.method === "PUT") {
      state = JSON.parse(body) as FakeGitHubState;
      requests = [];
      return send(204, null);
    }
    if (path === "/_fake/requests" && req.method === "GET") {
      return send(200, requests);
    }

    requests.push({
      method: req.method ?? "GET",
      host: req.headers.host,
      path,
      authorization: req.headers.authorization,
      body: body ? JSON.parse(body) : undefined,
    });

    const avatar = /^\/avatars\/([^/?]+)/.exec(path);
    if (avatar && req.method === "GET") {
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(avatarPng(decodeURIComponent(avatar[1])));
    }

    if (req.headers.authorization !== `Bearer ${state.viewer.token}`) {
      return send(401, { message: "Bad credentials" });
    }
    if (path === "/graphql" && req.method === "POST") {
      const { query, variables } = JSON.parse(body) as {
        query: string;
        variables: Record<string, string>;
      };
      return send(200, { data: graphql(query, variables) });
    }
    send(404, { message: "Not Found" });
  });

  function graphql(query: string, variables: Record<string, string>) {
    const data: Record<string, unknown> = {};
    if (/\bviewer\s*\{/.test(query))
      data.viewer = { login: state.viewer.login };
    for (const [, alias, variable] of query.matchAll(
      /(\w+)\s*:\s*search\(\s*query:\s*\$(\w+)/g
    )) {
      data[alias] = {
        nodes: search(variables[variable]).map((pr) => pullRequestNode(pr)),
      };
    }
    return data;
  }

  /** GitHub's issue search, for the qualifiers the Inbox uses. */
  function search(q: string): FakePullRequest[] {
    const me = state.viewer.login;
    const filters: ((pr: FakePullRequest) => boolean)[] = [];
    for (const term of q.split(/\s+/).filter(Boolean)) {
      const [key, value] = term.split(":");
      const user = value === "@me" ? me : value;
      if (term === "is:pr" || term === "archived:false") continue;
      else if (term === "is:open")
        filters.push((pr) => (pr.state ?? "OPEN") === "OPEN");
      else if (key === "repo")
        filters.push(
          (pr) => pr.repository.toLowerCase() === value.toLowerCase()
        );
      else if (key === "author") filters.push((pr) => pr.author === user);
      else if (key === "review-requested")
        filters.push((pr) => (pr.reviewRequested ?? []).includes(user));
      else throw new Error(`The fake GitHub does not know "${term}"`);
    }
    return state.pullRequests.filter((pr) => filters.every((f) => f(pr)));
  }

  function pullRequestNode(pr: FakePullRequest) {
    const [owner, name] = pr.repository.split("/");
    return {
      __typename: "PullRequest",
      number: pr.number,
      title: pr.title,
      url: `https://github.com/${pr.repository}/pull/${pr.number}`,
      updatedAt: pr.updatedAt ?? "2026-10-01T00:00:00Z",
      isDraft: false,
      headRefName: pr.headRefName ?? `feature-${pr.number}`,
      headRefOid: "0".repeat(40),
      baseRefName: pr.baseRefName ?? "main",
      repository: { nameWithOwner: `${owner}/${name}` },
      author: {
        login: pr.author,
        avatarUrl: `${state.avatarOrigin ?? url}/avatars/${encodeURIComponent(pr.author)}?v=4`,
      },
      commits: {
        nodes: [
          {
            commit: {
              statusCheckRollup: pr.checks ? { state: pr.checks } : null,
            },
          },
        ],
      },
    };
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** A 1x1 PNG whose colour depends on the login, so avatars can be told apart. */
export function avatarPng(login: string): Buffer {
  let hash = 0;
  for (const c of login) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const pixel = Buffer.from([
    0,
    hash & 255,
    (hash >> 8) & 255,
    (hash >> 16) & 255,
  ]);
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(pixel)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
