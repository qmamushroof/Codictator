// SPEC §6.4 EC-12: ts/lint never flags an exported binding as unused —
// an export is module public API whose importers live outside the file
// (and outside a diff scope), so unused exports stay with core/dead-code.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { CheckContext } from "../../../src/features/engine/index.ts";
import { resolveTsLint } from "../../../src/features/packs/enforcers/ts-checks.ts";
import type { PackRule } from "../../../src/features/packs/index.ts";
import type { EnforcerDecl } from "../../../src/features/packs/manifest.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";
import { createFakePorts } from "../../support/fake-ports.ts";

function makeRule(): PackRule {
	return {
		id: "ts/lint",
		family: "TS",
		tier: "floor",
		statement: "statement",
		reason: "reason",
		remediation: "fix {path}",
		enforcer: "ts/lint",
		triggers: ["review"],
		scope: [],
		params: {},
		measureVersion: 1,
		fixtures: { violating: ["basic"], passing: ["basic", "exported"] },
	};
}

function makeDecl(): EnforcerDecl {
	return { id: "ts/lint", kind: "code", budgetMs: 1000, args: {} };
}

async function lintFiles(
	files: ReadonlyArray<{ readonly name: string; readonly text: string }>,
): Promise<Array<string>> {
	const fakes = createFakePorts();
	for (const file of files) {
		fakes.fs.seedText(file.name, file.text);
	}
	const resolved = resolveTsLint(makeDecl(), makeRule(), fakes.ports);
	assert.ok(resolved.ok);
	const ctx: CheckContext = {
		trigger: "review",
		scope: { files: files.map((file) => file.name) },
		now: FIXED_INSTANT,
		configHash: "test",
	};
	const findings = await resolved.value.check(ctx, {});
	return findings
		.filter((finding) => finding.ruleId === "ts/lint")
		.map((finding) => finding.message);
}

test("[§6.4 EC-12] ts/lint skips exported bindings but flags unused locals and var", async () => {
	assert.deepEqual(
		await lintFiles([
			{ name: "public.ts", text: "export const MS_PER_DAY = 86_400_000;\n" },
		]),
		[],
	);
	assert.deepEqual(
		await lintFiles([
			{ name: "flags.ts", text: "const unused = 1;\nvar legacy = 2;\n" },
		]),
		["var binding legacy in flags.ts:2", "unused binding unused in flags.ts:1"],
	);
});
