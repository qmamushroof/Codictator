import { strict as assert } from "node:assert";

import test from "node:test";

import type { CheckContext } from "../../../src/features/engine/index.ts";

import { resolveCodeEnforcer } from "../../../src/features/packs/enforcers/code.ts";

import { resolveNoSpeculativeAbstraction } from "../../../src/features/packs/enforcers/health-abstraction.ts";

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
