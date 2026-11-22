// SPEC §5.7 core/arch-boundaries: the arch scope guards read marker reports
// only (the isMarkerFile filter code-health, ci-guards and deps-guards
// already use), so they never load the other scope files; under verify --all
// that read of every tracked file blew the 1000 ms budget (CDX-E902), see
// BUG-0118.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	resolveArchBoundaries,
	resolveArchModuleMapped,
	resolveArchNoCycles,
	resolveArchProfileDeclared,
	resolveArchPublicEntry,
} from "../../../src/features/packs/enforcers/arch-guards.ts";
import type { Result } from "../../../src/kernel/index.ts";
import { FakeFs } from "../../support/fake-fs.ts";
import {
	checked,
	ctxFor,
	DECL,
	portsWith,
	ruleFor,
	ruleIds,
} from "../../support/pre-tool-scenario.ts";

class CountingFs extends FakeFs {
	readonly reads: Array<string> = [];

	override read(path: string): Promise<Result<Uint8Array>> {
		this.reads.push(path);
		return super.read(path);
	}
}

const RESOLVERS = [
	["core/arch-profile-declared", resolveArchProfileDeclared],
	["core/arch-module-mapped", resolveArchModuleMapped],
	["core/arch-boundaries", resolveArchBoundaries],
	["core/arch-public-entry", resolveArchPublicEntry],
	["core/arch-no-cycles", resolveArchNoCycles],
] as const;

test("[§5.7] arch scope guards read only marker reports", async () => {
	const fs = new CountingFs();
	const files = ["sample.txt"];
	fs.seedText("sample.txt", "allowed: false\n");
	for (let i = 0; i < 40; i += 1) {
		const path = `src/f${i}.ts`;
		fs.seedText(path, "allowed: false\n");
		files.push(path);
	}
	for (const [id, resolve] of RESOLVERS) {
		const enforcer = checked(resolve(DECL, ruleFor(id), portsWith(fs)));
		const found = await enforcer.check(
			ctxFor({ files, proposedPaths: [], toolAccess: "read" }),
			{},
		);
		assert.equal(ruleIds(found).includes(id), id === "core/arch-boundaries");
	}
	assert.deepEqual([...new Set(fs.reads)], ["sample.txt"]);
});
