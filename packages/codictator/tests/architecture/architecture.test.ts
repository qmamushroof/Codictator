// Step 2.1 writes the architecture tests for every SPEC §10.3 item.
// Item 1 runs the real arch contract on the §3.3 module map and asserts
// zero findings; the contract still throws, so it fails red until phase 7.
// Item 5 holds green: every module folder already has its §3.3 row and leaf.

import { strict as assert } from "node:assert";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import type { ModuleNode } from "../../src/features/arch/index.ts";
import { buildGraph, checkArch } from "../../src/features/arch/index.ts";
import type { CheckContext } from "../../src/features/engine/index.ts";
import {
	collectSrcFiles,
	containingSpan,
	findJsonParseMatches,
	hasSplitJsonParse,
	readSrc,
	relativeToRepo,
	relativeToSrc,
	spanKey,
	srcRoot,
	stringLiteralSpans,
	toPosixPath,
} from "../support/arch-scan.ts";
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
// red-ledger runner core moved to src/features/testing/ in Phase 7 step
// 7.5, so the module map (§3.3, profiles.ts) owns it with no excuses.
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
	{ dir: "features/testing", leaf: "04-10-TESTING.md" },
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

const EXCUSED_INDEXED_DIRS: ReadonlySet<string> = new Set([]);

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

// Items 4 and 6 scan the staged src/ and hold green: only the
// testing module exists so far, so no src file may cross into another
// feature module or parse JSON. Items 2 and 3 live in
// import-boundaries.test.ts; tests/ stays out of every scan because it is
// non-production code (SPEC §3.1).

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

// SPEC §10.3 item 6 owns this allowlist: generated template text the module
// never executes (CI YAML scripts) may carry the JSON.parse text when the
// emitted output keeps the plain call. Each occurrence is keyed per
// occurrence by src path relative to the repository root plus the
// string-literal span holding the match; a match outside a string literal
// fails even in an allowlisted file, and splitting the call to evade the
// scan fails. An allowlist entry with no remaining match fails so dead
// entries cannot linger.
const ITEM_6_TEMPLATE_ALLOWLIST: ReadonlySet<string> = new Set([
	"packages/codictator/src/features/ci/workflow-live.ts:21:2-21:64",
	"packages/codictator/src/features/ci/workflow-live.ts:80:2-80:86",
]);

function item6FileOffenders(repoRel: string, text: string): Array<string> {
	const offenders: Array<string> = [];
	if (hasSplitJsonParse(text)) {
		offenders.push(`${repoRel}: split JSON.parse to evade the scan`);
	}
	const spans = stringLiteralSpans(text);
	for (const match of findJsonParseMatches(text)) {
		const span = containingSpan(spans, match.offset);
		if (span === undefined) {
			offenders.push(
				`${repoRel}:${match.line}:${match.column}: executable JSON.parse outside string literal`,
			);
			continue;
		}
		const key = spanKey(repoRel, span);
		if (!ITEM_6_TEMPLATE_ALLOWLIST.has(key)) {
			offenders.push(
				`${repoRel}:${match.line}:${match.column}: non-allowlisted template JSON.parse`,
			);
		}
	}
	return offenders;
}

test("[§10.3 item 6] JSON.parse appears only in the kernel", () => {
	const offenders: Array<string> = [];
	const covered = new Set<string>();
	for (const file of collectSrcFiles()) {
		const srcRel = relativeToSrc(file);
		if (srcRel.startsWith("kernel/")) {
			continue;
		}
		const repoRel = relativeToRepo(file);
		const text = readSrc(file);
		if (findJsonParseMatches(text).length === 0) {
			if (hasSplitJsonParse(text)) {
				offenders.push(`${repoRel}: split JSON.parse to evade the scan`);
			}
			continue;
		}
		for (const offense of item6FileOffenders(repoRel, text)) {
			offenders.push(offense);
		}
		const spans = stringLiteralSpans(text);
		for (const match of findJsonParseMatches(text)) {
			const span = containingSpan(spans, match.offset);
			if (span !== undefined) {
				covered.add(spanKey(repoRel, span));
			}
		}
	}
	for (const allowed of [...ITEM_6_TEMPLATE_ALLOWLIST].sort()) {
		if (!covered.has(allowed)) {
			offenders.push(`${allowed}: allowlist entry with no template match`);
		}
	}
	assert.deepEqual(offenders, []);
});

test("[§10.3 item 6] single-quote split fails beside a plain in-literal match", () => {
	// A single-quote concatenation is the same evasion as the double-quote
	// split, so the guard flags it even when the file also holds a plain
	// in-literal match that would pass through the allowlist.
	const text = [
		'const template = "run node -e JSON.parse(payload)";',
		"const evasive = 'JSON.' + 'parse(payload)';",
	].join("\n");
	const offenders = item6FileOffenders(
		"packages/codictator/src/features/ci/workflow-live.ts",
		text,
	);
	assert.equal(
		offenders.some((offense) => offense.includes("split JSON.parse")),
		true,
	);
});
