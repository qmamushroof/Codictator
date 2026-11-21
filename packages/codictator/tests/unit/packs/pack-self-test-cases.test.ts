// SPEC §4.4.1 + §4.4.4 (BUG-0095): self-test evaluates each case.json for
// real. The case files are the only files in scope, the enforcer runs with
// the case trigger, and a missing or malformed case file fails its case.
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { Pack, PackRule } from "../../../src/features/packs/index.ts";
import {
	loadBuiltinPack,
	resolveManifestEnforcers,
	selfTest,
} from "../../../src/features/packs/index.ts";
import { livePorts } from "../../../src/features/packs/registry.ts";
import { NodeFs } from "../../../src/kernel/index.ts";

const RULE = "core/file-size";

function bigSource(): string {
	const rows: Array<string> = [];
	for (let n = 1; n <= 320; n += 1) {
		rows.push(`export const row${n} = 1;`);
	}
	return `${rows.join("\n")}\n`;
}

function caseBody(
	expectation: "violating" | "passing",
	files: Record<string, string>,
	expectRules: ReadonlyArray<string>,
): string {
	return JSON.stringify({
		rule: RULE,
		section: "§5.6",
		expectation,
		trigger: "pre-tool",
		expectRules,
		files,
	});
}

const SMALL = { "src/small.ts": "export const a = 1;\n" };
const BIG = { "src/big.ts": bigSource() };

async function sizePack(
	violating: string,
	passing: string,
): Promise<{ pack: Pack; dir: string }> {
	const core = await loadBuiltinPack("core");
	assert.ok(core.ok);
	const rule = core.value.manifest.rules.find((r) => r.id === RULE);
	assert.ok(rule !== undefined);
	const decl = core.value.manifest.enforcers.find(
		(e) =>
			typeof e === "object" &&
			e !== null &&
			"id" in e &&
			e.id === rule.enforcer,
	);
	assert.ok(decl !== undefined);
	const bound: PackRule = {
		...rule,
		fixtures: { violating: [violating], passing: [passing] },
	};
	const manifest = {
		...core.value.manifest,
		rules: [bound],
		enforcers: [decl],
	};
	const root = mkdtempSync(join(tmpdir(), "cdx-selftest-"));
	const ports = await livePorts(root);
	assert.ok(ports.ok);
	const enforcers = resolveManifestEnforcers(manifest, ports.value);
	assert.ok(enforcers.ok);
	return {
		pack: { ...core.value, manifest, enforcers: enforcers.value },
		dir: root,
	};
}

function put(dir: string, rel: string, text: string): void {
	mkdirSync(dirname(join(dir, rel)), { recursive: true });
	writeFileSync(join(dir, rel), text);
}

function caseAt(dir: string, kind: string, name: string, text?: string): void {
	if (text !== undefined) {
		put(dir, `fixtures/file-size/${kind}/${name}/case.json`, text);
	}
}

async function run(
	violating: string | undefined,
	passing: string | undefined,
): Promise<{ ok: boolean; code?: string }> {
	const made = await sizePack("v", "p");
	try {
		caseAt(made.dir, "violating", "v", violating);
		caseAt(made.dir, "passing", "p", passing);
		const fs = await NodeFs.create({ root: made.dir });
		assert.ok(fs.ok);
		const result = await selfTest(made.pack, { fs: fs.value, dir: "." });
		return result.ok ? { ok: true } : { ok: false, code: result.error.code };
	} finally {
		rmSync(made.dir, { recursive: true, force: true });
	}
}

test("[§4.4.4] self-test runs each case over its own files and passes when the rule fires only on the violating case", async () => {
	const result = await run(
		caseBody("violating", BIG, [RULE]),
		caseBody("passing", SMALL, []),
	);
	assert.deepEqual(result, { ok: true });
});

test("[§4.4.4] self-test fails CDX-E212 when a violating case's files do not violate", async () => {
	const result = await run(
		caseBody("violating", SMALL, [RULE]),
		caseBody("passing", SMALL, []),
	);
	assert.deepEqual(result, { ok: false, code: "CDX-E212" });
});

test("[§4.4.4] self-test fails CDX-E213 when a passing case's files violate", async () => {
	const result = await run(
		caseBody("violating", BIG, [RULE]),
		caseBody("passing", BIG, []),
	);
	assert.deepEqual(result, { ok: false, code: "CDX-E213" });
});

test("[§4.4.4] a violating case needs non-empty expectRules, all present in the findings", async () => {
	const empty = await run(
		caseBody("violating", BIG, []),
		caseBody("passing", SMALL, []),
	);
	assert.deepEqual(empty, { ok: false, code: "CDX-E212" });
	const absent = await run(
		caseBody("violating", BIG, [RULE, "core/other"]),
		caseBody("passing", SMALL, []),
	);
	assert.deepEqual(absent, { ok: false, code: "CDX-E212" });
});

test("[§4.4.1] a missing or malformed case.json fails CDX-E212 under violating and CDX-E213 under passing", async () => {
	const good = {
		violating: caseBody("violating", BIG, [RULE]),
		passing: caseBody("passing", SMALL, []),
	};
	assert.deepEqual(await run(undefined, good.passing), {
		ok: false,
		code: "CDX-E212",
	});
	assert.deepEqual(await run("{ not json", good.passing), {
		ok: false,
		code: "CDX-E212",
	});
	assert.deepEqual(await run(good.violating, undefined), {
		ok: false,
		code: "CDX-E213",
	});
	assert.deepEqual(await run(good.violating, "{}"), {
		ok: false,
		code: "CDX-E213",
	});
	assert.deepEqual(
		await run(
			good.violating,
			caseBody("passing", { "src/a.ts": 1 } as never, []),
		),
		{ ok: false, code: "CDX-E213" },
	);
});

test("[§4.4.4] regression BUG-0095: a violating case is judged on its own case files, not an empty scope", async () => {
	// The case files exist only in memory (the pack dir holds none of them):
	// the old empty-scope run found nothing either way, so a broken violating
	// case could not be told from a good one. Now the big case passes and the
	// small one fails CDX-E212.
	const broken = await run(
		caseBody("violating", SMALL, [RULE]),
		caseBody("passing", SMALL, []),
	);
	assert.deepEqual(broken, { ok: false, code: "CDX-E212" });
	const good = await run(
		caseBody("violating", BIG, [RULE]),
		caseBody("passing", SMALL, []),
	);
	assert.deepEqual(good, { ok: true });
});
