// BUG-0119 (SPEC §4.5.4): the generated OpenCode bridge is committed in this
// repo, so it must carry no lint suppression (core/no-new-suppressions).

import { strict as assert } from "node:assert";
import test from "node:test";
import { OPENCODE_BRIDGE_SOURCE } from "../../../src/features/adapters/opencode-bridge.ts";

test("[§4.5.4] the generated OpenCode bridge carries no lint suppression", () => {
	assert.equal(OPENCODE_BRIDGE_SOURCE.includes(`${"biome"}-ignore`), false);
});
