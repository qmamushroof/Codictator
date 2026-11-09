// SPEC §5.6 core/duplication, BUG-0084: the task-record and branch reads
// behind the packs, steering and CLI active-task lookups live once in
// workflow/task-store.ts. Runs the real duplication resolver over the real
// source files, so a re-copied reader fails here before ci verify.
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { CheckContext } from "../../../src/features/engine/index.ts";
import { resolveDuplication } from "../../../src/features/packs/enforcers/health-duplication.ts";
import type { PackRule } from "../../../src/features/packs/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";
import { createFakePorts } from "../../support/fake-ports.ts";

const READERS = [
	"src/cli/git-history.ts",
	"src/cli/packs.ts",
	"src/cli/tasks.ts",
	"src/features/packs/enforcers/scope-tasks.ts",
	"src/features/steering/task-summary.ts",
	"src/features/workflow/task-store.ts",
];

const RULE: PackRule = {
	id: "core/duplication",
	family: "F6",
	tier: "tunable",
	statement: "No duplicated token runs above minTokens.",
	reason: "Copies drift and fix in one place only.",
	remediation: "Extract the duplication at {path}:{line} into one helper.",
	enforcer: "core/duplication",
	triggers: ["review"],
	scope: [],
	params: {
		minTokens: { type: "integer", default: 50, bound: 100, stricter: "lower" },
	},
	measureVersion: 1,
	fixtures: { violating: ["basic"], passing: ["basic"] },
};

test("[§5.6] task-record and branch reads keep one copy across packs, steering and cli", async () => {
	const root = path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		"..",
		"..",
		"..",
	);
	const fakes = createFakePorts();
	const present: Array<string> = [];
	for (const file of READERS) {
		// The shared reader is absent before the extraction; judge what exists.
		const full = path.join(root, file);
		if (!existsSync(full)) {
			continue;
		}
		fakes.fs.seedText(file, readFileSync(full, "utf8"));
		present.push(file);
	}
	const made = resolveDuplication(
		{ id: "core/duplication", kind: "code", budgetMs: 1000, args: {} },
		RULE,
		fakes.ports,
	);
	assert.ok(made.ok);
	if (!made.ok) {
		return;
	}
	const ctx: CheckContext = {
		trigger: "review",
		scope: { files: present },
		now: FIXED_INSTANT,
		configHash: "test",
	};
	assert.deepEqual(await made.value.check(ctx, {}), []);
});
