// SPEC §6.1 ts/lint + BUG-0091: blankCode skips regex literals, so a quote
// inside one never opens a string that blanks real uses of a later binding.
import { strict as assert } from "node:assert";
import test from "node:test";
import { blankCode as blankPackCode } from "../../../src/builtin-packs/typescript/lex.ts";
import type { CheckContext } from "../../../src/features/engine/index.ts";
import { blankCode } from "../../../src/features/packs/enforcers/health-lex.ts";
import { resolveTsLint } from "../../../src/features/packs/enforcers/ts-checks.ts";
import type { PackRule } from "../../../src/features/packs/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";
import { createFakePorts } from "../../support/fake-ports.ts";

const DQ = String.fromCharCode(34);
const REGEX_WITH_QUOTE = `/${DQ}/`;

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

async function lintMessages(text: string): Promise<Array<string>> {
	const fakes = createFakePorts();
	fakes.fs.seedText("a.ts", text);
	const resolved = resolveTsLint(
		{ id: "ts/lint", kind: "code", budgetMs: 1000, args: {} },
		makeRule(),
		fakes.ports,
	);
	assert.ok(resolved.ok);
	const ctx: CheckContext = {
		trigger: "review",
		scope: { files: ["a.ts"] },
		now: FIXED_INSTANT,
		configHash: "test",
	};
	const findings = await resolved.value.check(ctx, {});
	return findings.map((finding) => finding.message);
}

test("[§6.1] blankCode keeps code after a regex literal that holds a quote (BUG-0091)", () => {
	const src = `check(x, ${REGEX_WITH_QUOTE}, ${DQ}msg${DQ});\nconst later = 1;\n`;
	const blanked = blankCode(src);
	assert.ok(blanked.includes("const later = 1;"));
	assert.ok(!blanked.includes("msg"));
	assert.equal(blanked.length, src.length);
});

test("[§6.1] blankCode treats a slash after a value as division, not a regex", () => {
	const src = `const half = total / 2; const s = ${DQ}a${DQ}; const r = half / 3;\n`;
	assert.equal(
		blankCode(src),
		`const half = total / 2; const s = ${" ".repeat(3)}; const r = half / 3;\n`,
	);
});

test("[§6.1] blankCode skips a quote inside a regex character class", () => {
	const src = `const p = x.match(/[${DQ}/]+/);\nconst later = 1;\n`;
	assert.ok(blankCode(src).includes("const later = 1;"));
});

test("[§6.1] ts/lint counts a binding used after a regex literal that holds a quote (BUG-0091)", async () => {
	const text = `const later = ${DQ}x${DQ};\nexport const ok = /a${DQ}/.test(${DQ}s${DQ}) && later === ${DQ}x${DQ};\n`;
	assert.deepEqual(await lintMessages(text), []);
	assert.deepEqual(await lintMessages("const unused = 1;\n"), [
		"unused binding unused in a.ts:1",
	]);
});

test("[§6.1] blankCode keeps a JSX closing tag as code, never a regex (BUG-0091)", () => {
	const src = "export const v = <A>x</A><B>{used}</B>;";
	assert.equal(blankCode(src), src);
	assert.equal(blankPackCode(src), src);
});

test("[§6.1] blankCode skips a regex literal after an arrow (BUG-0091)", () => {
	const src = `const t = (s: string) => /a${DQ}/.test(s);
const later = 1;
`;
	assert.ok(blankCode(src).includes("const later = 1;"));
});

test("[§6.1] typescript pack blankCode skips a regex literal that holds a quote (BUG-0091)", () => {
	const src = `check(x, ${REGEX_WITH_QUOTE}, ${DQ}msg${DQ});
const later = 1;
`;
	const blanked = blankPackCode(src);
	assert.ok(blanked.includes("const later = 1;"));
	assert.ok(!blanked.includes("msg"));
	assert.equal(blanked.length, src.length);
});

test("[§6.1] typescript pack blankCode treats a slash after a value as division", () => {
	const src = `const half = total / 2; const s = ${DQ}a${DQ}; const r = half / 3;
`;
	assert.equal(
		blankPackCode(src),
		`const half = total / 2; const s = ${" ".repeat(3)}; const r = half / 3;
`,
	);
});
