// SPEC §4.4.1 + §4.4.4: a built-in case.json is evaluated for real. Its files
// are the only files in scope, the enforcer runs with the case trigger, a
// violating case yields every expectRules id and a passing case yields no
// finding carrying its rule. This is the case contract the self-test will
// enforce (BUG-0095); until then this test holds the fixtures to it.
import { strict as assert } from "node:assert";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { Finding, Trigger } from "../../../src/features/engine/index.ts";
import {
	loadBuiltinPack,
	resolveManifestEnforcers,
} from "../../../src/features/packs/index.ts";
import { livePorts } from "../../../src/features/packs/registry.ts";

const PACKS = fileURLToPath(
	new URL("../../../src/builtin-packs", import.meta.url),
);
const PACK_IDS = ["core", "typescript", "python"] as const;

interface CaseFile {
	readonly rule: string;
	readonly expectation: "violating" | "passing";
	readonly trigger: Trigger;
	readonly expectRules: ReadonlyArray<string>;
	readonly files: Readonly<Record<string, string>>;
}

function readCase(file: string): CaseFile {
	return JSON.parse(readFileSync(file, "utf8"));
}

async function findingsFor(
	pack: string,
	rule: string,
	enforcerId: string,
	body: CaseFile,
): Promise<Array<Finding>> {
	const loaded = await loadBuiltinPack(pack);
	assert.ok(loaded.ok);
	const root = mkdtempSync(join(tmpdir(), "cdx-case-"));
	try {
		for (const [rel, text] of Object.entries(body.files)) {
			mkdirSync(dirname(join(root, rel)), { recursive: true });
			writeFileSync(join(root, rel), text);
		}
		const ports = await livePorts(root);
		assert.ok(ports.ok);
		const enforcers = resolveManifestEnforcers(
			loaded.value.manifest,
			ports.value,
		);
		assert.ok(enforcers.ok);
		const enforcer =
			enforcers.value.find((e) => e.id === enforcerId) ??
			enforcers.value.find((e) => e.id === rule);
		assert.ok(enforcer !== undefined, `no enforcer for ${rule}`);
		return await enforcer.check(
			{
				trigger: body.trigger,
				scope: { files: Object.keys(body.files).sort() },
				now: "self-test",
				configHash: "self-test",
			},
			{},
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

async function failuresOf(pack: string): Promise<Array<string>> {
	const loaded = await loadBuiltinPack(pack);
	assert.ok(loaded.ok);
	const failed: Array<string> = [];
	for (const rule of loaded.value.manifest.rules) {
		const slug = rule.id.split("/")[1] ?? "";
		for (const kind of ["violating", "passing"] as const) {
			const dir = join(PACKS, pack, "fixtures", slug, kind);
			for (const name of readdirSync(dir).sort()) {
				const body = readCase(join(dir, name, "case.json"));
				const found = (
					await findingsFor(pack, rule.id, rule.enforcer, body)
				).map((finding) => finding.ruleId);
				const bad =
					kind === "violating"
						? body.expectRules.length === 0 ||
							body.expectRules.some((id) => !found.includes(id))
						: found.includes(rule.id);
				if (bad) {
					failed.push(`${pack}/${slug}/${kind}/${name}`);
				}
			}
		}
	}
	return failed;
}

for (const pack of PACK_IDS) {
	test(`[§4.4.4] every ${pack} pack case.json evaluates to its expectation`, async () => {
		assert.deepEqual(await failuresOf(pack), []);
	});
}
