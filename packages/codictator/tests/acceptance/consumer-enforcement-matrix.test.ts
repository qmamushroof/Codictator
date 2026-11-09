// Slice 0 meta-guard, part 1: every tier:floor rule in the loaded packs maps
// to one consumer-shaped scenario through a real entry point (MATRIX in the
// support matrix module). A new floor rule with no row fails here; the firing
// halves live in the firing-l1/l34 suites. Green by construction.
import { strict as assert } from "node:assert";
import test from "node:test";
import { loadBuiltinPack } from "../../src/features/packs/loader.ts";
import { MATRIX } from "../support/consumer-matrix.ts";

async function floorRules(): Promise<Map<string, ReadonlyArray<string>>> {
	const found = new Map<string, ReadonlyArray<string>>();
	for (const pack of ["core", "typescript", "python"]) {
		const loaded = await loadBuiltinPack(pack);
		assert.ok(loaded.ok, `${pack} pack loads`);
		if (loaded.ok) {
			for (const rule of loaded.value.manifest.rules) {
				if (rule.tier === "floor") {
					found.set(rule.id, [...rule.triggers]);
				}
			}
		}
	}
	return found;
}

test("[consumer] every tier:floor rule has a mapped scenario", async () => {
	const rules = await floorRules();
	const mapped = new Set(MATRIX.map(([rule]) => rule));
	const missing = [...rules.keys()].filter((id) => !mapped.has(id));
	assert.deepEqual(missing, [], `unmapped floor rules: ${missing.join(", ")}`);
	const stale = MATRIX.map(([rule]) => rule).filter((id) => !rules.has(id));
	assert.deepEqual(stale, [], `stale rows: ${stale.join(", ")}`);
	const triggerless = [...rules.entries()]
		.filter(
			([, triggers]) =>
				!triggers.some(
					(trigger) =>
						trigger === "pre-tool" ||
						trigger === "startup" ||
						trigger === "review",
				),
		)
		.map(([id]) => id);
	assert.deepEqual(
		triggerless,
		[],
		`floor rules with no L-surface: ${triggerless.join(", ")}`,
	);
});
