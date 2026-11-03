// SPEC §5.11 + §4.4.1 (BUG-0021): core/conventional-commit judges the
// commit-subject marker reports (sample.txt), never source files. A source
// file carrying a `subject:` line — a `subject: string` parameter, a YAML
// key, prose — is not a commit subject; only marker reports judge.
import { strict as assert } from "node:assert";
import test from "node:test";
import type {
	CheckContext,
	Enforcer,
} from "../../../src/features/engine/index.ts";
import { resolveConventionalCommit } from "../../../src/features/packs/enforcers/ci-guards.ts";
import type { PackRule, Result } from "../../../src/kernel/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";
import { createFakePorts } from "../../support/fake-ports.ts";

function ruleFor(): PackRule {
	return {
		id: "core/conventional-commit",
		family: "test",
		tier: "floor",
		statement: "a rule",
		reason: "testing",
		remediation: "rewrite the subject",
		enforcer: "test-enforcer",
		triggers: ["pre-tool"],
		scope: [],
		params: {},
		measureVersion: 1,
		fixtures: { violating: [], passing: [] },
	};
}

const DECL = { id: "test-enforcer", kind: "code", budgetMs: 1000 } as const;

function ctxFor(files: ReadonlyArray<string>): CheckContext {
	return {
		trigger: "pre-tool",
		scope: { files },
		now: FIXED_INSTANT,
		configHash: "config-hash",
	};
}

function liveEnforcer(files: Record<string, string>): Enforcer {
	const fakes = createFakePorts();
	for (const [name, content] of Object.entries(files)) {
		fakes.fs.seedText(name, content);
	}
	const resolved: Result<Enforcer> = resolveConventionalCommit(
		DECL,
		ruleFor(),
		fakes.ports,
	);
	assert.equal(resolved.ok, true);
	if (!resolved.ok) {
		throw new Error("resolver failed");
	}
	return resolved.value;
}

test("[§5.11] source file with a subject parameter stays clean", async () => {
	// BUG-0021: the upgrade.ts `subject: string` parameter parsed as a
	// commit subject and blocked verify --all; only marker reports judge.
	const findings = await liveEnforcer({
		"src/upgrade.ts":
			"export function entry(\n\tsubject: string,\n\twhen: string,\n): string {\n",
	}).check(ctxFor(["src/upgrade.ts"]), {});
	assert.equal(
		findings.filter((finding) => finding.ruleId === "core/conventional-commit")
			.length,
		0,
	);
});

test("[§5.11] marker report with a bad subject still blocks", async () => {
	const findings = await liveEnforcer({
		"sample.txt": "subject: fixed stuff\n",
	}).check(ctxFor(["sample.txt"]), {});
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/conventional-commit"),
	);
});

test("[§5.11] marker report with a conventional subject stays clean", async () => {
	const findings = await liveEnforcer({
		"sample.txt": "subject: fix(core): drop dead export\n",
	}).check(ctxFor(["sample.txt"]), {});
	assert.equal(
		findings.filter((finding) => finding.ruleId === "core/conventional-commit")
			.length,
		0,
	);
});
