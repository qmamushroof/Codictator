// SPEC §10.3 items 2 and 3: import and OS-touch boundaries. Split from
// architecture.test.ts so that file stays under core/file-size.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	collectSrcFiles,
	readSrc,
	relativeToSrc,
} from "../support/arch-scan.ts";

test("[§10.3 item 2] only generator and cli import llm", () => {
	const allowedPrefixes = ["features/generator/", "features/llm/", "cli/"];
	const llmImport =
		/from\s*[\x22\x27][^\x22\x27]*llm[^\x22\x27]*[\x22\x27]|import\s*\(\s*[\x22\x27][^\x22\x27]*llm/;
	const offenders: Array<string> = [];
	for (const file of collectSrcFiles()) {
		const relative = relativeToSrc(file);
		if (allowedPrefixes.some((prefix) => relative.startsWith(prefix))) {
			continue;
		}
		if (llmImport.exec(readSrc(file)) !== null) {
			offenders.push(relative);
		}
	}
	assert.deepEqual(offenders, []);
});

test("[§10.3 item 3] only kernel touches node:fs, network, fetch, clock or randomness", () => {
	const osImport =
		/from\s*[\x22\x27]node:(?:fs|child_process|net|https?|dns)\b|import\s*\(\s*[\x22\x27]node:(?:fs|child_process|net|https?|dns)\b/;
	const bareFetch = /(?:^|[^A-Za-z0-9_$])fetch\s*\(/;
	const bareDate = /new Date\(\s*\)/;
	const offenders: Array<string> = [];
	for (const file of collectSrcFiles()) {
		const relative = relativeToSrc(file);
		if (relative.startsWith("kernel/")) {
			continue;
		}
		const text = readSrc(file);
		const offenses: Array<string> = [];
		if (osImport.exec(text) !== null) {
			offenses.push("node os import");
		}
		if (bareFetch.exec(text) !== null) {
			offenses.push("fetch");
		}
		if (text.includes("Date.now")) {
			offenses.push("Date.now");
		}
		if (bareDate.exec(text) !== null) {
			offenses.push("new Date()");
		}
		if (text.includes("Math.random")) {
			offenses.push("Math.random");
		}
		if (offenses.length > 0) {
			offenders.push(`${relative}: ${offenses.join(", ")}`);
		}
	}
	assert.deepEqual(offenders, []);
});
