// Takes the Dashboard's marketing screenshot, in a dark and a light theme,
// in the Reviewer's own window: the review window has no Dashboard.
// Run it with `mise run screenshots`; it is not part of `mise run test`.

import { settle } from "../capture";
import { showDashboard } from "../dashboard";
import { refreshInbox } from "../github";
import { setUpScene, shoot, tearDownScene } from "./scene";

describe("Marketing screenshots, the Reviewer's own window", function () {
  this.timeout(10 * 60_000);

  before(async () => {
    await setUpScene();
  });

  after(tearDownScene);

  it("the Dashboard", async () => {
    await refreshInbox();
    await showDashboard();
    await settle(2000);
    await shoot("dashboard");
  });
});
