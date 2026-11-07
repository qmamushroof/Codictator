import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

function repoRoot(): string {
	const integrityDir = dirname(fileURLToPath(import.meta.url));
	return dirname(dirname(dirname(dirname(dirname(integrityDir)))));
}

function actionPins(workflowText: string): Array<string> {
	const pins: Array<string> = [];
	for (const match of workflowText.matchAll(/uses:\s*[^@\s]+@([0-9a-f]+)/g)) {
		const pin = match[1];
		if (pin !== undefined) {
			pins.push(pin);
		}
	}
	return pins;
}

test("[§4.8.3] e2e workflow action pins are complete SHAs", () => {
	// SPEC §4.8.3: action versions come from a registry lookup, pinned by
	// SHA. A truncated SHA resolves nowhere, so the e2e legs fail before
	// any step runs; every pin in the gate file must be a full SHA.
	const text = readFileSync(
		join(repoRoot(), ".github", "workflows", "test.yml"),
		"utf8",
	);
	const pins = actionPins(text);
	assert.ok(pins.length > 0, `workflow pins actions by SHA`);
	for (const pin of pins) {
		assert.equal(pin.length, 40, `pin ${pin} is a full 40-char SHA`);
	}
});
