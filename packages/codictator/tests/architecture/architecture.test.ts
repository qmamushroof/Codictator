// Step 1.7 writes the real architecture tests for every SPEC §10.3 item.
// Items 1 and 5 wait for the arch module (phase 7) and the phase 2 contracts,
// so these placeholders hold their ledger entries red until then.

import { strict as assert } from "node:assert";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("[§10.3 item 1] arch guard reports zero findings on its own src", () => {
	const guard = new URL("../../src/features/arch/index.ts", import.meta.url);
	assert.equal(existsSync(guard), true);
});

test("[§10.3 item 5] every module folder has a §3.3 row and SPEC leaf", () => {
	const features = new URL("../../src/features/", import.meta.url);
	assert.equal(existsSync(features), true);
});

// Items 2, 3, 4 and 6 scan the staged src/ and hold green: only the
// testing module exists so far, so no src file may import the LLM, touch
// the OS, cross into another feature module, or parse JSON. tests/ stays
// out of the scan because it is non-production code (SPEC §3.1); the
// tests/support driver is the only OS-touching test helper until the
// kernel lands.

function srcRoot(): string {
	return fileURLToPath(new URL("../../src/", import.meta.url));
}

function toPosixPath(value: string): string {
	return value.split(path.sep).join("/");
}

function collectSrcFiles(): Array<string> {
	const root = srcRoot();
	const found: Array<string> = [];
	const walk = (dir: string): void => {
		const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
			a.name < b.name ? -1 : 1,
		);
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else if (entry.isFile() && entry.name.endsWith(".ts")) {
				found.push(full);
			}
		}
	};
	walk(root);
	return found;
}

function relativeToSrc(file: string): string {
	return toPosixPath(path.relative(srcRoot(), file));
}

function readSrc(file: string): string {
	return readFileSync(file, "utf8");
}

test("[§10.3 item 2] only generator and cli import llm", () => {
	const allowedPrefixes = ["features/generator/", "features/llm/", "cli/"];
	const llmImport =
		/from\s*["'][^"']*llm[^"']*["']|import\s*\(\s*["'][^"']*llm/;
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
		/from\s*["']node:(?:fs|child_process|net|https?|dns)\b|import\s*\(\s*["']node:(?:fs|child_process|net|https?|dns)\b/;
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

function featureOfSpecifier(specifier: string): string | undefined {
	const marker = "features/";
	const markerIndex = specifier.indexOf(marker);
	if (markerIndex >= 0) {
		const rest = specifier.slice(markerIndex + marker.length);
		const slashIndex = rest.indexOf("/");
		return slashIndex < 0 ? rest : rest.slice(0, slashIndex);
	}
	if (specifier.startsWith("../")) {
		const name = specifier.split("/")[1];
		if (name === undefined || name === "" || name === "..") {
			return undefined;
		}
		return name;
	}
	return undefined;
}

function importedFeatures(text: string): Array<string> {
	const pattern = /from\s*["']([^"']+)["']/g;
	const features: Array<string> = [];
	let match = pattern.exec(text);
	while (match !== null) {
		const specifier = match[1] ?? "";
		const feature = featureOfSpecifier(specifier);
		if (feature !== undefined) {
			features.push(feature);
		}
		match = pattern.exec(text);
	}
	return features;
}

test("[§10.3 item 4] engine imports no feature module except config and audit", () => {
	const allowed = new Set(["config", "audit"]);
	const offenders: Array<string> = [];
	for (const file of collectSrcFiles()) {
		const relative = relativeToSrc(file);
		if (!relative.startsWith("features/engine/")) {
			continue;
		}
		for (const feature of importedFeatures(readSrc(file))) {
			if (!allowed.has(feature)) {
				offenders.push(`${relative} imports ${feature}`);
			}
		}
	}
	for (const file of collectSrcFiles()) {
		const relative = relativeToSrc(file);
		if (
			!relative.startsWith("features/adapters/") ||
			relative.startsWith("features/adapters/contract/")
		) {
			continue;
		}
		const allowedAdapters = new Set([
			"contract",
			"config",
			"engine",
			"steering",
		]);
		for (const feature of importedFeatures(readSrc(file))) {
			if (!allowedAdapters.has(feature)) {
				offenders.push(`${relative} imports ${feature}`);
			}
		}
	}
	assert.deepEqual(offenders, []);
});

test("[§10.3 item 6] JSON.parse appears only in the kernel", () => {
	const offenders: Array<string> = [];
	for (const file of collectSrcFiles()) {
		const relative = relativeToSrc(file);
		if (relative.startsWith("kernel/")) {
			continue;
		}
		if (/JSON\.parse\s*\(/.exec(readSrc(file)) !== null) {
			offenders.push(relative);
		}
	}
	assert.deepEqual(offenders, []);
});
