// SPEC §10.2 + §4.13.1: a test repo is configured as init would configure it,
// so each fixture repo's config validates against SPEC §7.2 and lists exactly
// the language packs of its languages (§6.4 EC-10 for mixed).
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateConfig } from "../../../src/features/config/index.ts";

const expected: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
	["ts-clean", ["typescript"]],
	["ts-brownfield", ["typescript"]],
	["python", ["python"]],
	["dotnet", ["dotnet"]],
	["mixed", ["typescript", "python", "dotnet"]],
];

test("[§10.2] each fixture repo config lists exactly its language packs and validates against the §7.2 config schema", () => {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const repos = path.resolve(here, "..", "..", "..", "fixtures", "repos");
	for (const [name, packs] of expected) {
		const file = path.join(repos, name, ".codictator", "config.json");
		const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
		const effective = validateConfig(raw);
		assert.deepEqual(
			effective.config.packs.map((pack) => pack.id),
			packs,
			name,
		);
	}
});
