// SPEC §4.4.4: fixture-per-rule generator driver. Discovery walks the owning
// pack's fixtures/ (§4.4.1); generation and evaluation throw until the pack
// self-test lands, so every emitted test executes and fails red meanwhile.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

// SPEC §4.4.4: emits one test per fixture case of the pack.
export function generateFixtureTests(_pack: string): Array<FixtureCase> {
	throw new Error("not implemented: SPEC §4.4.4");
}

// SPEC §4.4.4: a violating case must yield a finding; a passing case none.
export function runFixtureCase(_fixture: FixtureCase): void {
	throw new Error("not implemented: SPEC §4.4.4");
}
