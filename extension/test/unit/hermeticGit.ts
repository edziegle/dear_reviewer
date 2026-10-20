// Loaded by `.mocharc.json` before any unit test, so every git a test starts
// reads no global or system config: not the machine's signing options, aliases,
// excludes or identity. A test that needs a setting sets it in its own repository.

import * as os from "os";

process.env.GIT_CONFIG_GLOBAL = os.devNull;
process.env.GIT_CONFIG_SYSTEM = os.devNull;
