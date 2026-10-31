// SPEC §5.6 + §6.1: the 12.8 measure resolvers behind core/duplication and
// core/no-speculative-abstraction. Marker files carry the fixture measure
// reports; source files are judged with the shared lexer-light measures,
// first through CODE_RESOLVERS like every code enforcer (§4.4.3 step 4).
import { strict as assert } from "node:assert";
import test from "node:test";
import type { CheckContext } from "../../../src/features/engine/index.ts";
import { resolveCodeEnforcer } from "../../../src/features/packs/enforcers/code.ts";
import { resolveNoSpeculativeAbstraction } from "../../../src/features/packs/enforcers/health-abstraction.ts";
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

test("[§5.6] core/duplication and core/no-speculative-abstraction resolve through the code dispatcher", async () => {
	const fakes = createFakePorts();
	for (const id of [
		"core/duplication",
		"core/no-speculative-abstraction",
	] as const) {
		const resolved = resolveCodeEnforcer(
			{ id, kind: "code", budgetMs: 1000, args: {} },
			makeRule(id),
			fakes.ports,
		);
		assert.ok(resolved.ok);
		if (!resolved.ok) {
			continue;
		}
		assert.ok(
			resolved.value !== undefined,
			`${id} has no CODE_RESOLVERS entry`,
		);
		assert.equal(resolved.value?.id, id);
	}
});

test("[§5.6] core/no-speculative-abstraction marker violating flags one implementation", async () => {
	const fakes = createFakePorts();
	fakes.fs.seedText("sample.txt", "interface: Store\nimplementations: 1\n");
	const made = resolveNoSpeculativeAbstraction(
		makeDecl(),
		makeRule("core/no-speculative-abstraction"),
		fakes.ports,
	);
	assert.ok(made.ok);
	if (!made.ok) {
		return;
	}
	const findings = await made.value.check(context(["sample.txt"]), {});
	assert.ok(findings.length >= 1);
	for (const finding of findings) {
		assert.equal(finding.ruleId, "core/no-speculative-abstraction");
		assert.equal(finding.path, "sample.txt");
	}
});

test("[§5.6] core/no-speculative-abstraction marker passing stays clean with three", async () => {
	const fakes = createFakePorts();
	fakes.fs.seedText("sample.txt", "interface: Store\nimplementations: 3\n");
	const made = resolveNoSpeculativeAbstraction(
		makeDecl(),
		makeRule("core/no-speculative-abstraction"),
		fakes.ports,
	);
	assert.ok(made.ok);
	if (!made.ok) {
		return;
	}
	assert.deepEqual(await made.value.check(context(["sample.txt"]), {}), []);
});

test("[§5.6] core/no-speculative-abstraction abstract class with one extends flags", async () => {
	const fakes = createFakePorts();
	fakes.fs.seedText(
		"src/base.ts",
		"export abstract class Base {\n\tabstract run(): void;\n}\n",
	);
	fakes.fs.seedText(
		"src/only.ts",
		"import { Base } from './base';\nexport class Only extends Base {\n\trun(): void {}\n}\n",
	);
	const made = resolveNoSpeculativeAbstraction(
		makeDecl(),
		makeRule("core/no-speculative-abstraction"),
		fakes.ports,
	);
	assert.ok(made.ok);
	if (!made.ok) {
		return;
	}
	const findings = await made.value.check(
		context(["src/base.ts", "src/only.ts"]),
		{},
	);
	assert.ok(findings.length >= 1);
	assert.ok(findings.some((finding) => finding.message.includes("Base")));
});

test("[§5.6] core/no-speculative-abstraction ports entries and test doubles stay clean", async () => {
	const fakes = createFakePorts();
	const single = `export interface Store {\n\tget(key: string): string | undefined;\n}\nexport class MemoryStore implements Store {\n\tget(key: string): string | undefined {\n\t\treturn key;\n\t}\n}\n`;
	fakes.fs.seedText("src/features/demo/ports.ts", single);
	fakes.fs.seedText("src/features/demo/index.ts", single);
	fakes.fs.seedText("src/features/demo/demo.test.ts", single);
	fakes.fs.seedText(
		"double/sample.txt",
		"interface: Store\nimplementations: 1\ntest-double: true\n",
	);
	const made = resolveNoSpeculativeAbstraction(
		makeDecl(),
		makeRule("core/no-speculative-abstraction"),
		fakes.ports,
	);
	assert.ok(made.ok);
	if (!made.ok) {
		return;
	}
	assert.deepEqual(
		await made.value.check(
			context([
				"src/features/demo/ports.ts",
				"src/features/demo/index.ts",
				"src/features/demo/demo.test.ts",
				"double/sample.txt",
			]),
			{},
		),
		[],
	);
});

test("[§5.6] core/no-speculative-abstraction real-tree flags a single-implementation interface", async () => {
	const fakes = createFakePorts();
	fakes.fs.seedText(
		"src/store.ts",
		"export interface Store {\n\tget(key: string): string | undefined;\n}\n",
	);
	fakes.fs.seedText(
		"src/memory-store.ts",
		"import type { Store } from './store';\nexport class MemoryStore implements Store {\n\tget(key: string): string | undefined {\n\t\treturn key;\n\t}\n}\n",
	);
	const made = resolveNoSpeculativeAbstraction(
		makeDecl(),
		makeRule("core/no-speculative-abstraction"),
		fakes.ports,
	);
	assert.ok(made.ok);
	if (!made.ok) {
		return;
	}
	const findings = await made.value.check(
		context(["src/store.ts", "src/memory-store.ts"]),
		{},
	);
	assert.ok(findings.length >= 1);
	assert.ok(findings.some((finding) => finding.message.includes("Store")));
});
