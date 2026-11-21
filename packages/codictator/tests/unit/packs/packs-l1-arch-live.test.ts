// SPEC §4.11.4 + §4.11.5 EC-1/2/3/8: the four L1 architecture rules judge a
// live write against the configured module map (blocked before the edge
// exists), not only fixture marker reports (BUG-0105). Without a configured
// map there is nothing to judge, so the rules stay quiet.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { Enforcer, Finding } from "../../../src/features/engine/index.ts";
import {
	resolveArchBoundaries,
	resolveArchModuleMapped,
	resolveArchNoCycles,
	resolveArchPublicEntry,
} from "../../../src/features/packs/enforcers/arch-guards.ts";
import type { Ports, Result } from "../../../src/kernel/index.ts";
import { FakeFs } from "../../support/fake-fs.ts";
import {
	checked,
	ctxFor,
	DECL,
	portsWith,
	readScope,
	ruleFor,
	ruleIds,
	writeScope,
} from "../../support/pre-tool-scenario.ts";

const MAP = JSON.stringify({
	version: 1,
	architecture: {
		profile: "app",
		modules: [
			{ name: "alpha", path: "src/alpha/**", kind: "feature", dependsOn: [] },
			{ name: "beta", path: "src/beta/**", kind: "feature", dependsOn: [] },
		],
	},
});

type Resolver = (
	decl: typeof DECL,
	rule: ReturnType<typeof ruleFor>,
	ports: Ports,
) => Result<Enforcer>;

const RESOLVERS: ReadonlyArray<readonly [string, Resolver]> = [
	["core/arch-module-mapped", resolveArchModuleMapped],
	["core/arch-boundaries", resolveArchBoundaries],
	["core/arch-public-entry", resolveArchPublicEntry],
	["core/arch-no-cycles", resolveArchNoCycles],
];

function seeded(withMap: boolean): FakeFs {
	const fs = new FakeFs();
	if (withMap) {
		fs.seedText(".codictator/config.json", MAP);
	}
	fs.seedText("src/beta/index.ts", 'import "../alpha/index";\n');
	fs.seedText("src/alpha/index.ts", "export const a = 1;\n");
	return fs;
}

async function findingsOf(
	withMap: boolean,
	path: string,
	content: string,
	scope = writeScope(path, content),
): Promise<Array<string>> {
	const all: Array<Finding> = [];
	for (const [id, resolve] of RESOLVERS) {
		const enforcer = checked(
			resolve(DECL, ruleFor(id), portsWith(seeded(withMap))),
		);
		all.push(...(await enforcer.check(ctxFor(scope), {})));
	}
	return ruleIds(all);
}

test("[§4.11.5 EC-8] L1 arch-module-mapped blocks a write outside every module", async () => {
	const ids = await findingsOf(true, "src/zeta/x.ts", "export const z = 1;\n");
	assert.ok(ids.includes("core/arch-module-mapped"));
	assert.deepEqual(
		await findingsOf(true, "src/alpha/ok.ts", "export const z = 1;\n"),
		[],
	);
});

test("[§4.11.5 EC-2] L1 arch-boundaries blocks an import along an undeclared edge", async () => {
	const ids = await findingsOf(
		true,
		"src/alpha/a.ts",
		'import { b } from "../beta/index";\nexport const a = b;\n',
	);
	assert.ok(ids.includes("core/arch-boundaries"));
});

test("[§4.11.5 EC-1] L1 arch-public-entry blocks a deep import past the module entry", async () => {
	const ids = await findingsOf(
		true,
		"src/alpha/b.ts",
		'import { x } from "../beta/internal/x";\nexport const b = x;\n',
	);
	assert.ok(ids.includes("core/arch-public-entry"));
});

test("[§4.11.5 EC-3] L1 arch-no-cycles blocks an edge that closes a module cycle", async () => {
	const ids = await findingsOf(
		true,
		"src/alpha/c.ts",
		'import { b } from "../beta/index";\nexport const c = b;\n',
	);
	assert.ok(ids.includes("core/arch-no-cycles"));
});

test("[§4.11.4] L1 arch rules stay quiet without a configured map and on a read", async () => {
	assert.deepEqual(
		await findingsOf(false, "src/zeta/x.ts", 'import "../beta/internal/x";\n'),
		[],
	);
	assert.deepEqual(
		await findingsOf(true, "src/zeta/x.ts", "", readScope("src/zeta/x.ts")),
		[],
	);
});
