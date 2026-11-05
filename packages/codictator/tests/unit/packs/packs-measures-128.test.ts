import { strict as assert } from "node:assert";

import test from "node:test";

import type { CheckContext } from "../../../src/features/engine/index.ts";

import { resolveDuplication } from "../../../src/features/packs/enforcers/health-duplication.ts";

import type { PackRule } from "../../../src/features/packs/index.ts";

import type { EnforcerDecl } from "../../../src/features/packs/manifest.ts";

import { FIXED_INSTANT } from "../../support/fake-clock.ts";

import { createFakePorts } from "../../support/fake-ports.ts";

function makeRule(
	id: string,
	params: PackRule["params"] = {},
	tier: PackRule["tier"] = "floor",
): PackRule {
	return {
		id,
		family: "F6",
		tier,
		statement: "statement",
		reason: "reason",
		remediation: "fix {path}",
		enforcer: "test/check",
		triggers: ["review"],
		scope: [],
		params,
		measureVersion: 1,
		fixtures: { violating: ["basic"], passing: ["basic"] },
	};
}

function duplicationRule(minTokensDefault: number): PackRule {
	return makeRule(
		"core/duplication",
		{
			minTokens: {
				type: "integer",
				default: minTokensDefault,
				bound: 100,
				stricter: "lower",
			},
		},
		"tunable",
	);
}

function makeDecl(): EnforcerDecl {
	return { id: "test/check", kind: "code", budgetMs: 1000, args: {} };
}

function context(files: ReadonlyArray<string>): CheckContext {
	return {
		trigger: "review",
		scope: { files: [...files] },
		now: FIXED_INSTANT,
		configHash: "test",
	};
}

// A token run comfortably above minTokens 50 under any word-like
// tokenisation, so the contract does not pin the implementer's tokenizer.
const REPEATED_BLOCK = `export function sharedTotal(items: Array<number>): number {
	let total = 0;
	for (const item of items) {
		if (item > 0) {
			total += item;
		}
	}
	const doubled = total * 2;
	const capped = doubled > 100 ? 100 : doubled;
	return capped + items.length;
}
`;

test("[§5.6] core/duplication marker violating flags a run over minTokens", async () => {
	const fakes = createFakePorts();
	fakes.fs.seedText("sample.txt", "duplicated-tokens: 80\nlimit: 50\n");
	const made = resolveDuplication(makeDecl(), duplicationRule(50), fakes.ports);
	assert.ok(made.ok);
	if (!made.ok) {
		return;
	}
	const findings = await made.value.check(context(["sample.txt"]), {});
	assert.ok(findings.length >= 1);
	for (const finding of findings) {
		assert.equal(finding.ruleId, "core/duplication");
		assert.equal(finding.path, "sample.txt");
	}
});

test("[§5.6] core/duplication marker passing stays clean below minTokens", async () => {
	const fakes = createFakePorts();
	fakes.fs.seedText("sample.txt", "duplicated-tokens: 12\nlimit: 50\n");
	const made = resolveDuplication(makeDecl(), duplicationRule(50), fakes.ports);
	assert.ok(made.ok);
	if (!made.ok) {
		return;
	}
	assert.deepEqual(await made.value.check(context(["sample.txt"]), {}), []);
});

test("[§5.6] core/duplication minTokens boundary equal stays clean", async () => {
	const fakes = createFakePorts();
	fakes.fs.seedText("sample.txt", "duplicated-tokens: 50\n");
	const made = resolveDuplication(makeDecl(), duplicationRule(50), fakes.ports);
	assert.ok(made.ok);
	if (!made.ok) {
		return;
	}
	assert.deepEqual(await made.value.check(context(["sample.txt"]), {}), []);
});

test("[§5.6] core/duplication tunable minTokens narrows the measure", async () => {
	const fakes = createFakePorts();
	fakes.fs.seedText("sample.txt", "duplicated-tokens: 80\n");
	const strict = resolveDuplication(
		makeDecl(),
		duplicationRule(50),
		fakes.ports,
	);
	assert.ok(strict.ok);
	if (!strict.ok) {
		return;
	}
	assert.ok(
		(await strict.value.check(context(["sample.txt"]), {})).length >= 1,
	);
	const loose = resolveDuplication(
		makeDecl(),
		duplicationRule(100),
		fakes.ports,
	);
	assert.ok(loose.ok);
	if (!loose.ok) {
		return;
	}
	assert.deepEqual(await loose.value.check(context(["sample.txt"]), {}), []);
});

test("[§5.6] core/duplication real-tree flags a repeated token run", async () => {
	const fakes = createFakePorts();
	fakes.fs.seedText("src/alpha.ts", REPEATED_BLOCK);
	fakes.fs.seedText("src/beta.ts", REPEATED_BLOCK);
	const made = resolveDuplication(makeDecl(), duplicationRule(50), fakes.ports);
	assert.ok(made.ok);
	if (!made.ok) {
		return;
	}
	const files = ["src/alpha.ts", "src/beta.ts"];
	const first = await made.value.check(context(files), {});
	assert.ok(first.length >= 1);
	for (const finding of first) {
		assert.equal(finding.ruleId, "core/duplication");
	}
	const second = await made.value.check(context(files), {});
	assert.deepEqual(second, first);
	const order = first.map((finding) => `${finding.path}:${finding.line ?? 0}`);
	assert.deepEqual([...order].sort(), order);
});

test("[§5.6] core/duplication blankCode normalization ignores comments and strings", async () => {
	const fakes = createFakePorts();
	fakes.fs.seedText("src/real.ts", REPEATED_BLOCK);
	const commented = REPEATED_BLOCK.split("\n")
		.map((line) => (line.length > 0 ? `// ${line}` : line))
		.join("\n");
	fakes.fs.seedText("src/echo.ts", `${commented}\n`);
	fakes.fs.seedText(
		"src/quoted.ts",
		`export const echo = ${JSON.stringify(REPEATED_BLOCK)};\n`,
	);
	const made = resolveDuplication(makeDecl(), duplicationRule(50), fakes.ports);
	assert.ok(made.ok);
	if (!made.ok) {
		return;
	}
	assert.deepEqual(
		await made.value.check(
			context(["src/real.ts", "src/echo.ts", "src/quoted.ts"]),
			{},
		),
		[],
	);
});

test("[§5.6] core/duplication resolver carries the pack budget and id", async () => {
	const fakes = createFakePorts();
	const made = resolveDuplication(makeDecl(), duplicationRule(50), fakes.ports);
	assert.ok(made.ok);
	if (!made.ok) {
		return;
	}
	assert.equal(made.value.id, "core/duplication");
	assert.equal(made.value.budgetMs, 1000);
});
