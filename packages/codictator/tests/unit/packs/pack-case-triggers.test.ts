// SPEC §4.4.1: a built-in fixture case.json carries a Trigger value (§4.3.2)
// in `trigger`, never prose; the prose lives in the optional `description`.
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { TRIGGERS } from "../../../src/features/engine/index.ts";

const PACKS = fileURLToPath(
	new URL("../../../src/builtin-packs", import.meta.url),
);

function caseFiles(dir: string): Array<string> {
	const found: Array<string> = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			found.push(...caseFiles(path));
		} else if (name === "case.json") {
			found.push(path);
		}
	}
	return found;
}

test("[§4.4.1] every built-in case.json trigger is a Trigger value", () => {
	const files = caseFiles(PACKS);
	assert.ok(files.length > 0);
	const bad = files.filter((file) => {
		const parsed: { trigger?: unknown } = JSON.parse(
			readFileSync(file, "utf8"),
		);
		return !(TRIGGERS as ReadonlyArray<unknown>).includes(parsed.trigger);
	});
	assert.deepEqual(bad, []);
});
