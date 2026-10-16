// A fetch that gives up on a host that never answers. A lookup or connection
// that fails fast already throws an error `isUnreachable` recognises; a stuck
// resolver or a dropped packet makes `fetch` wait forever instead.

/** How long GitHub has to start answering before the request is given up. */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Fetches, giving up if the response hasn't started within `timeoutMs`. The
 * limit ends when the response starts, so a large or slow body still loads.
 */
export async function fetchWithin(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (!timedOut) throw err;
    // The code is the one Node gives a connection that timed out.
    throw new TypeError("fetch failed", {
      cause: Object.assign(new Error(`no answer within ${timeoutMs} ms`), {
        code: "ETIMEDOUT",
      }),
    });
  } finally {
    clearTimeout(timer);
  }
}
