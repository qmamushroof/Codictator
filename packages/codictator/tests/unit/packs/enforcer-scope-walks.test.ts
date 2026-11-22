// SPEC §6.3 and §4.15.2: the shared scope walk of the Python resolvers and the direct-push judge of core/branch-protection.
import { strict as assert } from "node:assert";
import test from "node:test";
import type {
	CheckContext,
	Finding,
} from "../../../src/features/engine/index.ts";
import { bindRule } from "../../../src/features/packs/enforcers/binding.ts";
import * as ciGuards from "../../../src/features/packs/enforcers/ci-guards.ts";
import * as pyChecks from "../../../src/features/packs/enforcers/py-checks.ts";
import type { PackRule } from "../../../src/features/packs/index.ts";
import { notFoundError } from "../../../src/kernel/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";
import { createFakePorts } from "../../support/fake-ports.ts";

const rule: PackRule = {
	id: "python/typecheck",
	family: "F3",
	tier: "floor",
	statement: "statement",
	reason: "reason",
	remediation: "fix {path}",
	enforcer: "python/typecheck",
	triggers: ["review"],
	scope: [],
	params: {},
	measureVersion: 1,
	fixtures: { violating: ["basic"], passing: ["basic"] },
};

function ctxFor(files: ReadonlyArray<string>): CheckContext {
	return {
		trigger: "review",
		scope: { files: [...files] },
		now: FIXED_INSTANT,
		configHash: "test",
	};
}

test("[§6.3] python scope walk hands python files to the judge and reports unreadable ones", async () => {
	const fakes = createFakePorts();
	fakes.fs.seedText("a.py", "x = 1\n");
	fakes.fs.seedText("note.txt", "skip me");
	const binding = bindRule(rule);
	const findings: Array<Finding> = [];
	const judged: Array<string> = [];
	await pyChecks.judgePythonFiles(
		fakes.ports,
		binding,
		ctxFor(["a.py", "note.txt"]),
		findings,
		(file, text) => {
			judged.push(`${file}=${text}`);
		},
	);
	assert.deepEqual(judged, ["a.py=x = 1\n"]);
	assert.equal(findings.length, 0);
	fakes.fs.failNext(notFoundError("gone.py"));
	await pyChecks.judgePythonFiles(
		fakes.ports,
		binding,
		ctxFor(["gone.py"]),
		findings,
		() => {
			judged.push("unexpected");
		},
	);
	assert.equal(judged.length, 1);
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.path, "gone.py");
});

test("[§4.15.2] direct push judge flags only a direct marker", () => {
	const binding = bindRule({
		...rule,
		id: "core/branch-protection",
		enforcer: "core/branch-protection",
	});
	const findings: Array<Finding> = [];
	ciGuards.judgeDirectPush(
		binding,
		"quiet.txt",
		new Map([["direct", "false"]]),
		findings,
	);
	assert.equal(findings.length, 0);
	ciGuards.judgeDirectPush(
		binding,
		"loud.txt",
		new Map([
			["direct", "true"],
			["push", "trunk"],
		]),
		findings,
	);
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.path, "loud.txt");
});
