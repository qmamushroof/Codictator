// Step 2.1 writes the architecture tests for every SPEC §10.3 item.
// Item 1 runs the real arch contract on the §3.3 module map and asserts
// zero findings; the contract still throws, so it fails red until phase 7.
// Item 5 holds green: every module folder already has its §3.3 row and leaf.

import { strict as assert } from "node:assert";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { ModuleNode } from "../../src/features/arch/index.ts";
import { buildGraph, checkArch } from "../../src/features/arch/index.ts";
import type { CheckContext } from "../../src/features/engine/index.ts";
import { FIXED_INSTANT } from "../support/fake-clock.ts";

test("[§10.3 item 1] arch guard runs on own src with §3.3 map and reports zero findings", async () => {
	// SPEC §10.3 item 1 with the §3.3 module map: the guard dogfoods its own
	// src and must report zero findings. buildGraph/checkArch still throw
	// "not implemented", so this executes and fails red until phase 7 lands.
	const modules: Array<ModuleNode> = [
		{ name: "kernel", path: "src/kernel/**", dependsOn: [] },
		{ name: "config", path: "src/features/config/**", dependsOn: [] },
		{ name: "engine", path: "src/features/engine/**", dependsOn: ["config"] },
		{ name: "arch", path: "src/features/arch/**", dependsOn: [] },
	];
	const ctx: CheckContext = {
		trigger: "pre-tool",
		scope: { files: ["src/features/arch/index.ts"], sessionId: "session-1" },
		now: FIXED_INSTANT,
		configHash: "config-hash",
	};
	const edges = buildGraph(modules, []);
	const findings = await checkArch(ctx, edges);
	assert.deepEqual(findings, []);
});

test("[§10.3 item 5] every module folder has a §3.3 row and SPEC leaf", () => {
	for (const mod of expectedModules) {
		const dir = path.join(srcRoot(), ...mod.dir.split("/"));
		assert.equal(existsSync(dir), true, `missing module folder src/${mod.dir}`);
		assert.equal(
			existsSync(path.join(dir, "index.ts")),
			true,
			`missing public entry src/${mod.dir}/index.ts`,
		);
		assert.equal(
			existsSync(path.join(specDir(), mod.leaf)),
			true,
			`missing SPEC leaf docs/SPEC/${mod.leaf} for src/${mod.dir}`,
		);
	}
	const expectedDirs = new Set(expectedModules.map((mod) => mod.dir));
	const unexpected = collectIndexedDirs().filter(
		(dir) => !expectedDirs.has(dir) && !EXCUSED_INDEXED_DIRS.has(dir),
	);
	assert.deepEqual(unexpected, []);
});

// Every SPEC §3.3 module row and the SPEC leaf that owns its contract. The
// legacy src/testing/ runner predates these contracts and moves to
// src/features/testing/ later; it is the only excused indexed dir.
const expectedModules: ReadonlyArray<{
	readonly dir: string;
	readonly leaf: string;
}> = [
	{ dir: "kernel", leaf: "04-01-KERNEL.md" },
	{ dir: "features/config", leaf: "04-02-CONFIG.md" },
	{ dir: "features/engine", leaf: "04-03-ENGINE.md" },
	{ dir: "features/packs", leaf: "04-04-PACKS.md" },
	{ dir: "features/adapters", leaf: "04-05-ADAPTERS.md" },
	{ dir: "features/steering", leaf: "04-06-STEERING.md" },
	{ dir: "features/security", leaf: "04-07-SECURITY-GUARDS.md" },
	{ dir: "features/deps", leaf: "04-08-DEPENDENCIES.md" },
	{ dir: "features/records", leaf: "04-09-RECORDS.md" },
	{ dir: "features/arch", leaf: "04-11-ARCHITECTURE-GUARDS.md" },
	{ dir: "features/workflow", leaf: "04-12-WORKFLOW.md" },
	{ dir: "features/remediation", leaf: "04-13-REMEDIATION.md" },
	{ dir: "features/integrity", leaf: "04-14-INTEGRITY.md" },
	{ dir: "features/ci", leaf: "04-15-CI.md" },
	{ dir: "features/generator", leaf: "04-16-GENERATOR.md" },
	{ dir: "features/llm", leaf: "04-17-LLM.md" },
	{ dir: "features/audit", leaf: "04-18-AUDIT.md" },
	{ dir: "cli", leaf: "04-19-CLI.md" },
	{ dir: "builtin-packs/core", leaf: "05-CORE-RULES.md" },
	{ dir: "builtin-packs/typescript", leaf: "06-LANGUAGE-PACKS.md" },
	{ dir: "builtin-packs/dotnet", leaf: "06-LANGUAGE-PACKS.md" },
	{ dir: "builtin-packs/python", leaf: "06-LANGUAGE-PACKS.md" },
];

const EXCUSED_INDEXED_DIRS: ReadonlySet<string> = new Set(["testing"]);

function specDir(): string {
	return path.resolve(srcRoot(), "..", "..", "..", "docs", "SPEC");
}

function collectIndexedDirs(): Array<string> {
	const root = srcRoot();
	const found: Array<string> = [];
	const walk = (dir: string): void => {
		const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
			a.name < b.name ? -1 : 1,
		);
		if (entries.some((entry) => entry.isFile() && entry.name === "index.ts")) {
			found.push(toPosixPath(path.relative(root, dir)));
		}
		for (const entry of entries) {
			if (entry.isDirectory()) {
				walk(path.join(dir, entry.name));
			}
		}
	};
	walk(root);
	return found.filter((dir) => dir !== "");
}

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
