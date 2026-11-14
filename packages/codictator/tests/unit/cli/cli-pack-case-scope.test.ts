// BUG-0101 + SPEC §4.4.1 + §4.7.1: verify drops pack case paths only.
// config.security.fixtureGlobs relaxes secret detection, never a scope, so a
// testdata file stays in every verify scope.
import { strict as assert } from "node:assert";
import test from "node:test";
import { resolveVerifyScope } from "../../../src/cli/evaluate.ts";
import { portsFor } from "../../../src/cli/shared.ts";
import { createTempRepo } from "../../support/temp-repo.ts";

const CASE = "packs/demo/fixtures/core-x/violating/basic/case.json";
const STAGED_CASE = "packs/demo/fixtures/core-x/passing/basic/case.json";

test("[§4.4.1] verify scope drops pack case paths but keeps testdata and fixtures dirs (BUG-0101)", async () => {
	const repo = createTempRepo({
		[CASE]: "{}",
		"testdata/run.sh": "echo\n",
		"fixtures/plain/a.txt": "x\n",
	});
	try {
		repo.writeFile(STAGED_CASE, "{}");
		const made = await portsFor(repo.dir);
		assert.equal(made.ok, true);
		if (!made.ok) {
			return;
		}
		const ports = {
			ok: true as const,
			value: { ...made.value, packRoots: ["packs/demo"] },
		};
		assert.equal(ports.ok, true);
		if (!ports.ok) {
			return;
		}
		for (const flags of [
			{ staged: false, all: true },
			{ staged: true, all: false },
		]) {
			const scope = await resolveVerifyScope(ports.value, {
				...flags,
				base: undefined,
				head: undefined,
				layer: undefined,
			});
			assert.equal(scope.ok, true);
			if (!scope.ok) {
				return;
			}
			assert.ok(!scope.value.files.includes(CASE));
			assert.ok(!scope.value.files.includes(STAGED_CASE));
			if (flags.all) {
				assert.ok(scope.value.files.includes("testdata/run.sh"));
				assert.ok(scope.value.files.includes("fixtures/plain/a.txt"));
			}
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.4.1] verify scope keeps a stray pack.json fixtures path judged (BUG-0102)", async () => {
	const stray = "evil/fixtures/a/passing/b/run.sh";
	const repo = createTempRepo({
		"evil/pack.json": "{}",
		[stray]: "echo\n",
		[CASE]: "{}",
	});
	try {
		const made = await portsFor(repo.dir);
		assert.equal(made.ok, true);
		if (!made.ok) {
			return;
		}
		const ports = { ...made.value, packRoots: ["packs/demo"] };
		const scope = await resolveVerifyScope(ports, {
			staged: false,
			all: true,
			base: undefined,
			head: undefined,
			layer: undefined,
		});
		assert.equal(scope.ok, true);
		if (!scope.ok) {
			return;
		}
		assert.ok(scope.value.files.includes(stray));
		assert.ok(!scope.value.files.includes(CASE));
		const bare = await resolveVerifyScope(made.value, {
			staged: false,
			all: true,
			base: undefined,
			head: undefined,
			layer: undefined,
		});
		assert.equal(bare.ok && bare.value.files.includes(CASE), true);
	} finally {
		repo.cleanup();
	}
});
