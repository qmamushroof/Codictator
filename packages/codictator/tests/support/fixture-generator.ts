// SPEC §4.4.4: fixture-per-rule generator driver. Discovery walks the owning
// pack's fixtures/ (§4.4.1); generation emits one test per case, and
// evaluation runs the rule's own enforcer against the case files on fake
// ports, so implemented enforcers pass while deferred-kind cases throw
// CDX-E901 and stay red until their module lands.
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CheckContext, Trigger } from "../../src/features/engine/index.ts";
import { TRIGGERS } from "../../src/features/engine/index.ts";
import type { PackManifest, PackRule } from "../../src/features/packs/index.ts";
import { resolvePackEnforcers } from "../../src/features/packs/index.ts";
import {
	checkPack,
	type EnforcerDecl,
	narrowEnforcerDecl,
	narrowManifest,
} from "../../src/features/packs/manifest.ts";
import { parseJson } from "../../src/kernel/index.ts";
import { FIXED_INSTANT } from "./fake-clock.ts";
import { createFakePorts } from "./fake-ports.ts";

export type FixtureKind = "violating" | "passing";

export interface FixtureCase {
	readonly pack: string;
	readonly rule: string;
	readonly section: string;
	readonly kind: FixtureKind;
	readonly name: string;
	readonly dir: string;
}

export interface FixtureManifest {
	readonly rule: string;
	readonly section: string;
	readonly expectation: FixtureKind;
	readonly trigger: string;
	readonly reason: string;
	readonly remediation: string;
	readonly expectRules: ReadonlyArray<string>;
	readonly files: Record<string, string>;
}

// SPEC §4.4.1: the owning pack's fixtures/ live beside its manifest.
export function packFixturesDir(pack: string): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(
		here,
		"..",
		"..",
		"src",
		"builtin-packs",
		pack,
		"fixtures",
	);
}

function childDirs(dir: string): Array<string> {
	return readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
}

// SPEC §4.4.4: one emitted test per fixture case, in sorted order.
export function discoverFixtureCases(pack: string): Array<FixtureCase> {
	const root = packFixturesDir(pack);
	const found: Array<FixtureCase> = [];
	for (const slug of childDirs(root)) {
		const ruleDir = path.join(root, slug);
		for (const kind of childDirs(ruleDir)) {
			if (kind !== "violating" && kind !== "passing") {
				continue;
			}
			const kindDir = path.join(ruleDir, kind);
			for (const name of childDirs(kindDir)) {
				const manifestPath = path.join(kindDir, name, "case.json");
				let manifest: FixtureManifest;
				try {
					manifest = JSON.parse(
						readFileSync(manifestPath, "utf8"),
					) as FixtureManifest;
				} catch {
					continue;
				}
				found.push({
					pack,
					rule: manifest.rule,
					section: manifest.section,
					kind: kind as FixtureKind,
					name,
					dir: path.join(kindDir, name),
				});
			}
		}
	}
	found.sort((a, b) =>
		a.rule < b.rule
			? -1
			: a.rule > b.rule
				? 1
				: a.kind < b.kind
					? -1
					: a.kind > b.kind
						? 1
						: a.name < b.name
							? -1
							: 1,
	);
	return found;
}

// SPEC §4.4.1: every case carries its trigger, expected rule ids and tree.
export function readFixtureManifest(fixture: FixtureCase): FixtureManifest {
	const raw = readFileSync(path.join(fixture.dir, "case.json"), "utf8");
	return JSON.parse(raw) as FixtureManifest;
}

// SPEC §4.4.4: emits one test per fixture case of the pack. Discovery
// already walks the owning pack's fixtures/ in sorted order, so emitting
// is returning that walk; the per-case test asserts the run.
export function generateFixtureTests(pack: string): Array<FixtureCase> {
	return discoverFixtureCases(pack);
}

function loadPackManifest(pack: string): PackManifest {
	const raw = readFileSync(
		path.join(packFixturesDir(pack), "..", "pack.json"),
		"utf8",
	);
	const parsed = parseJson(raw);
	assert.ok(parsed.ok, `pack ${pack} ships valid JSON in pack.json`);
	const narrowed = narrowManifest(parsed.value);
	assert.ok(narrowed.ok, `pack ${pack} narrows to the §7.3 manifest`);
	const checked = checkPack(narrowed.value, true);
	assert.ok(checked.ok, `built-in pack ${pack} passes the §4.4.3 checks`);
	return narrowed.value;
}

function triggerOf(rule: PackRule): Trigger {
	const first: unknown = rule.triggers[0];
	if (typeof first === "string") {
		for (const trigger of TRIGGERS) {
			if (trigger === first) {
				return trigger;
			}
		}
	}
	return "startup";
}

// SPEC §4.4.4: a violating case must yield a finding with the rule id; a
// passing case must yield none. The rule's own enforcer runs against the
// case files on fake ports, so a deferred (later-module) enforcer throws
// CDX-E901 here and the case stays red until its module lands.
export async function runFixtureCase(fixture: FixtureCase): Promise<void> {
	const manifest = readFixtureManifest(fixture);
	const pack = loadPackManifest(fixture.pack);
	const rule = pack.rules.find((entry) => entry.id === fixture.rule);
	assert.ok(
		rule !== undefined,
		`fixture ${fixture.dir} names unknown rule ${fixture.rule}`,
	);
	const decls: Array<EnforcerDecl> = [];
	for (const entry of pack.enforcers) {
		const narrowed = narrowEnforcerDecl(entry);
		assert.ok(
			narrowed.ok,
			`pack ${fixture.pack} declares a narrowable enforcer`,
		);
		decls.push(narrowed.value);
	}
	const fakes = createFakePorts();
	for (const [name, content] of Object.entries(manifest.files)) {
		fakes.fs.seedText(name, content);
	}
	const resolved = resolvePackEnforcers(pack, decls, fakes.ports, [], {});
	assert.ok(
		resolved.ok,
		`pack ${fixture.pack} resolves its enforcers for fixtures`,
	);
	const enforcer =
		resolved.value.find((entry) => entry.id === rule.enforcer) ??
		resolved.value.find((entry) => entry.id === rule.id);
	assert.ok(
		enforcer !== undefined,
		`rule ${rule.id} binds an enforcer for its fixtures`,
	);
	const ctx: CheckContext = {
		trigger: triggerOf(rule),
		scope: { files: Object.keys(manifest.files).sort() },
		now: FIXED_INSTANT,
		configHash: "fixture",
	};
	const findings = await enforcer.check(ctx, {});
	if (fixture.kind === "violating") {
		assert.ok(
			findings.some((finding) => finding.ruleId === fixture.rule),
			`violating fixture ${fixture.dir} yielded no ${fixture.rule} finding`,
		);
		return;
	}
	assert.ok(
		!findings.some((finding) => finding.ruleId === fixture.rule),
		`passing fixture ${fixture.dir} yielded a ${fixture.rule} finding`,
	);
}
