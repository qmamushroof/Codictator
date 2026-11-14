// SPEC §4.3.2 + §4.7 (ts and python rules): the L1 hook scope is the tool call (files is empty),
// so content rules judge it through the one pre-tool file adapter: the
// proposed target with the text the call carries. Before the adapter the
// history, deps, ts and python content rules looped ctx.scope.files and
// never saw an L1 write, and a read-only call was never kept apart.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { Finding, Scope } from "../../../src/features/engine/index.ts";
import { resolvePythonNoPhantomImport } from "../../../src/features/packs/enforcers/py-phantom.ts";
import { resolvePythonSecurityPatterns } from "../../../src/features/packs/enforcers/py-security-patterns.ts";
import { resolveTsNoPhantomImport } from "../../../src/features/packs/enforcers/ts-phantom.ts";
import { resolveTsSecurityPatterns } from "../../../src/features/packs/enforcers/ts-security-patterns.ts";
import { FakeFs } from "../../support/fake-fs.ts";
import {
	checked,
	ctxFor,
	DECL,
	editScope,
	portsWith,
	readScope,
	ruleFor,
	ruleIds,
	writeScope,
} from "../../support/pre-tool-scenario.ts";

async function tsPhantomFindings(
	scope: Scope,
	fs: FakeFs = new FakeFs(),
): Promise<Array<Finding>> {
	const enforcer = checked(
		resolveTsNoPhantomImport(
			DECL,
			ruleFor("ts/no-phantom-import"),
			portsWith(fs),
		),
	);
	return enforcer.check(ctxFor(scope), {});
}

test("[§4.3.2] L1 ts/no-phantom-import judges the proposed content imports", async () => {
	const phantom = 'import { x } from "ghost-pkg";\nexport const y = x;\n';
	assert.ok(
		ruleIds(await tsPhantomFindings(writeScope("src/a.ts", phantom))).includes(
			"ts/no-phantom-import",
		),
	);
	assert.ok(
		ruleIds(await tsPhantomFindings(editScope("src/a.ts", phantom))).includes(
			"ts/no-phantom-import",
		),
		"an edit fragment's imports are judged too",
	);
	assert.deepEqual(
		await tsPhantomFindings(
			writeScope("src/a.ts", 'import { x } from "./local";\nexport { x };\n'),
		),
		[],
	);
	assert.deepEqual(await tsPhantomFindings(readScope("src/a.ts")), []);
});

test("[§4.3.2] L1 ts/no-phantom-import accepts an import the nearest manifest declares", async () => {
	const fs = new FakeFs();
	fs.seedText("package.json", '{"dependencies":{"left-pad":"1.0.0"}}\n');
	assert.deepEqual(
		await tsPhantomFindings(
			writeScope("src/a.ts", 'import pad from "left-pad";\nexport { pad };\n'),
			fs,
		),
		[],
	);
});

// Split literals keep this test source clean under the repo's own text scans.
const EVIL_TS = `export const r = ev${"al"}(code);\n`;
const EVIL_PY = `code = input()\nev${"al"}(code)\n`;

test("[§4.3.2] L1 ts/security-patterns judges the proposed content", async () => {
	const enforcer = checked(
		resolveTsSecurityPatterns(
			DECL,
			ruleFor("ts/security-patterns"),
			portsWith(new FakeFs()),
		),
	);
	assert.ok(
		ruleIds(
			await enforcer.check(ctxFor(writeScope("src/a.ts", EVIL_TS)), {}),
		).includes("ts/security-patterns"),
	);
	assert.ok(
		ruleIds(
			await enforcer.check(ctxFor(editScope("src/a.ts", EVIL_TS)), {}),
		).includes("ts/security-patterns"),
		"an edit fragment's lines are judged too",
	);
	assert.deepEqual(await enforcer.check(ctxFor(readScope("src/a.ts")), {}), []);
});

async function pyPhantomFindings(
	scope: Scope,
	fs: FakeFs = new FakeFs(),
): Promise<Array<Finding>> {
	const enforcer = checked(
		resolvePythonNoPhantomImport(
			DECL,
			ruleFor("python/no-phantom-import"),
			portsWith(fs),
		),
	);
	return enforcer.check(ctxFor(scope), {});
}

test("[§4.3.2] L1 python/no-phantom-import judges the proposed content imports", async () => {
	assert.ok(
		ruleIds(
			await pyPhantomFindings(
				writeScope("py/a.py", "import does_not_exist_xyz\n"),
			),
		).includes("python/no-phantom-import"),
	);
	assert.deepEqual(
		await pyPhantomFindings(writeScope("py/a.py", "import os\n")),
		[],
	);
	assert.deepEqual(await pyPhantomFindings(readScope("py/a.py")), []);
});

test("[§4.3.2] L1 python/no-phantom-import accepts a first-party sibling module", async () => {
	const fs = new FakeFs();
	fs.seedText("py/helper.py", "x = 1\n");
	assert.deepEqual(
		await pyPhantomFindings(writeScope("py/a.py", "import helper\n"), fs),
		[],
	);
});

test("[§4.3.2] L1 python/security-patterns judges the proposed content", async () => {
	const enforcer = checked(
		resolvePythonSecurityPatterns(
			DECL,
			ruleFor("python/security-patterns"),
			portsWith(new FakeFs()),
		),
	);
	assert.ok(
		ruleIds(
			await enforcer.check(ctxFor(writeScope("py/a.py", EVIL_PY)), {}),
		).includes("python/security-patterns"),
	);
	assert.deepEqual(await enforcer.check(ctxFor(readScope("py/a.py")), {}), []);
});
