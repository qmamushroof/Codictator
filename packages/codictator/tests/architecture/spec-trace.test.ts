// ROADMAP step 2.9 (SPEC §10.1): the SPEC-trace completeness gate. It parses
// every SPEC leaf, enumerates each `EC-n` row and each §5–§6 rule row, and
// fails when no test title cites it. It is never listed: a complete suite
// keeps it green, and an incomplete one fails the run.

import { strict as assert } from "node:assert";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	discoverFixtureCases,
	packFixturesDir,
} from "../support/fixture-generator.ts";

interface SpecInventory {
	readonly ecKeys: Set<string>;
	readonly ruleSections: Map<string, string>;
}

const HEADING_PATTERN = /^##\s+(\d+(?:\.\d+)*)\b/;
const EC_ROW_PATTERN = /^\|\s*EC-(\d+)\b/;
const RULE_ROW_PATTERN = /^\|\s*`((?:core|ts|dotnet|python)\/[A-Za-z0-9-]+)`/;
const TITLE_PATTERN = /\b(?:test|it|describe)\s*\(\s*["'`]([^"'`\n]*?)["'`]/g;
const TITLE_REF_PATTERN = /^\[(§\d+(?:\.\d+)*)( EC-\d+)?\]/;
const RULE_ID_PATTERN = /\b((?:core|ts|dotnet|python)\/[A-Za-z0-9-]+)\b/g;

function repoRoot(): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(here, "..", "..", "..", "..");
}

function collectFiles(root: string, suffix: string): Array<string> {
	const found: Array<string> = [];
	if (!existsSync(root)) {
		return found;
	}
	const walk = (dir: string): void => {
		const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
			a.name < b.name ? -1 : 1,
		);
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else if (entry.isFile() && entry.name.endsWith(suffix)) {
				found.push(full);
			}
		}
	};
	walk(root);
	return found;
}

function majorSection(heading: string): string {
	return heading.split(".").slice(0, 2).join(".");
}

// SPEC §4.10.1: `EC-n` rows live under `## 4.N.*` (cited as `§4.N`) and the
// §6.4 table; rule rows live under `## 5.N` and `## 6.N`.
function parseSpecFile(text: string, inventory: SpecInventory): void {
	let section = "";
	for (const line of text.split("\n")) {
		const heading = HEADING_PATTERN.exec(line);
		if (heading !== null) {
			section = majorSection(heading[1] ?? "");
			continue;
		}
		const trimmed = line.trimStart();
		const ec = EC_ROW_PATTERN.exec(trimmed);
		if (ec !== null && section !== "") {
			inventory.ecKeys.add(`§${section} EC-${ec[1] ?? ""}`);
			continue;
		}
		const rule = RULE_ROW_PATTERN.exec(trimmed);
		if (rule !== null && section !== "") {
			const key = `§${section}`;
			const id = rule[1] ?? "";
			if (
				(key.startsWith("§5.") || key.startsWith("§6.")) &&
				!inventory.ruleSections.has(id)
			) {
				inventory.ruleSections.set(id, key);
			}
		}
	}
}

function inventoryOfSpec(): SpecInventory {
	const inventory: SpecInventory = {
		ecKeys: new Set<string>(),
		ruleSections: new Map<string, string>(),
	};
	const root = repoRoot();
	const router = path.join(root, "docs", "SPEC.md");
	if (existsSync(router)) {
		parseSpecFile(readFileSync(router, "utf8"), inventory);
	}
	for (const file of collectFiles(path.join(root, "docs", "SPEC"), ".md")) {
		parseSpecFile(readFileSync(file, "utf8"), inventory);
	}
	return inventory;
}

function builtinPackNames(): Array<string> {
	const packsDir = path.join(
		repoRoot(),
		"packages",
		"codictator",
		"src",
		"builtin-packs",
	);
	if (!existsSync(packsDir)) {
		return [];
	}
	return readdirSync(packsDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
}

// Titles starting with `[§...]` (SPEC §10.1). The fixture-per-rule file emits
// its titles from a template, so this expands the same template over the
// discovered cases to see the titles the runner executes.
function titlesOfSuite(): Array<string> {
	const titles: Array<string> = [];
	const testsRoot = path.join(repoRoot(), "packages");
	for (const file of collectFiles(testsRoot, ".test.ts")) {
		if (!file.split(path.sep).includes("tests")) {
			continue;
		}
		const text = readFileSync(file, "utf8");
		for (const match of text.matchAll(TITLE_PATTERN)) {
			titles.push(match[1] ?? "");
		}
	}
	for (const pack of builtinPackNames()) {
		if (!existsSync(packFixturesDir(pack))) {
			continue;
		}
		for (const fixture of discoverFixtureCases(pack)) {
			titles.push(
				`[${fixture.section}] ${fixture.rule} ${fixture.kind}/${fixture.name}`,
			);
		}
	}
	return titles;
}

function citedKeys(titles: ReadonlyArray<string>): {
	readonly ec: Set<string>;
	readonly rules: Set<string>;
} {
	const ec = new Set<string>();
	const rules = new Set<string>();
	for (const title of titles) {
		if (title.includes("${")) {
			continue;
		}
		const ref = TITLE_REF_PATTERN.exec(title);
		if (ref === null) {
			continue;
		}
		const section = ref[1] ?? "";
		const ecPart = ref[2] ?? "";
		if (ecPart !== "") {
			ec.add(`${section}${ecPart}`);
		}
		for (const match of title.matchAll(RULE_ID_PATTERN)) {
			rules.add(match[1] ?? "");
		}
	}
	return { ec, rules };
}

test("[§10.1] SPEC-trace completeness: every EC row and rule row has a citing test", () => {
	const inventory = inventoryOfSpec();
	const cited = citedKeys(titlesOfSuite());
	const missingEc = [...inventory.ecKeys]
		.filter((key) => !cited.ec.has(key))
		.sort();
	const missingRules = [...inventory.ruleSections.keys()]
		.filter((rule) => !cited.rules.has(rule))
		.sort();
	assert.deepEqual(
		missingEc,
		[],
		`SPEC EC rows without a citing test (${missingEc.length} of ${inventory.ecKeys.size}): ${missingEc.join(", ")}`,
	);
	assert.deepEqual(
		missingRules,
		[],
		`SPEC rule rows without a citing test (${missingRules.length} of ${inventory.ruleSections.size}): ${missingRules.join(", ")}`,
	);
});
