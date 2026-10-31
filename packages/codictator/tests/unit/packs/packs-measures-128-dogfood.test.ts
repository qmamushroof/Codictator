// SPEC §5.6 + §10.3.1: the 12.8 dogfood contract. Both measure resolvers
// must report zero findings over an exemption-shaped tree (ports, module
// entries, test paths) and over small unique files; the implementer repeats
// the same assertion over the real packages/codictator/src/** during
// validation (roadmap step 12.8 verify: no false positive on our own src).
import { strict as assert } from "node:assert";
import test from "node:test";
import type { CheckContext } from "../../../src/features/engine/index.ts";
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

// The exemption-shaped tree: single-implementation abstractions that live
// where §3.4 contracts, module entries and test doubles allow them, plus
// small files with no repeated 50-token run.
function seedDogfoodTree(fs: {
	seedText(path: string, text: string): void;
}): void {
	const single = `export interface Store {\n\tget(key: string): string | undefined;\n}\nexport class MemoryStore implements Store {\n\tget(key: string): string | undefined {\n\t\treturn key;\n\t}\n}\n`;
	fs.seedText("src/features/demo/ports.ts", single);
	fs.seedText("src/features/demo/index.ts", single);
	fs.seedText("src/features/demo/demo.test.ts", single);
	fs.seedText(
		"src/features/demo/types.ts",
		"export interface Loader {\n\tload(path: string): string;\n}\nexport interface Saver {\n\tsave(path: string, text: string): void;\n}\n",
	);
	fs.seedText(
		"src/features/demo/file-loader.ts",
		"import type { Loader } from './types';\nexport class FileLoader implements Loader {\n\tload(path: string): string {\n\t\treturn path;\n\t}\n}\n",
	);
	fs.seedText(
		"src/features/demo/memory-loader.ts",
		"import type { Loader } from './types';\nexport class MemoryLoader implements Loader {\n\tload(path: string): string {\n\t\treturn path;\n\t}\n}\n",
	);
	fs.seedText(
		"src/features/demo/disk-saver.ts",
		"import type { Saver } from './types';\nexport class DiskSaver implements Saver {\n\tsave(path: string, text: string): void {}\n}\n",
	);
	fs.seedText(
		"src/features/demo/tape-saver.ts",
		"import type { Saver } from './types';\nexport class TapeSaver implements Saver {\n\tsave(path: string, text: string): void {}\n}\n",
	);
}

const TREE = [
	"src/features/demo/ports.ts",
	"src/features/demo/index.ts",
	"src/features/demo/demo.test.ts",
	"src/features/demo/types.ts",
	"src/features/demo/file-loader.ts",
	"src/features/demo/memory-loader.ts",
	"src/features/demo/disk-saver.ts",
	"src/features/demo/tape-saver.ts",
];

test("[§5.6] core/duplication dogfood exemption-shaped tree stays clean", async () => {
	const fakes = createFakePorts();
	seedDogfoodTree(fakes.fs);
	const made = resolveDuplication(
		makeDecl(),
		makeRule(
			"core/duplication",
			{
				minTokens: {
					type: "integer",
					default: 50,
					bound: 100,
					stricter: "lower",
				},
			},
			"tunable",
		),
		fakes.ports,
	);
	assert.ok(made.ok);
	if (!made.ok) {
		return;
	}
	assert.deepEqual(await made.value.check(context(TREE), {}), []);
});

test("[§5.6] core/no-speculative-abstraction dogfood exemption-shaped tree stays clean", async () => {
	const fakes = createFakePorts();
	seedDogfoodTree(fakes.fs);
	const made = resolveNoSpeculativeAbstraction(
		makeDecl(),
		makeRule("core/no-speculative-abstraction"),
		fakes.ports,
	);
	assert.ok(made.ok);
	if (!made.ok) {
		return;
	}
	assert.deepEqual(await made.value.check(context(TREE), {}), []);
});
