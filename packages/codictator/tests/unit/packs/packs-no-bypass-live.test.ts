// SPEC §4.14.2 + §4.14.3 (BUG-0018): the live core/no-bypass enforcer
// judges the L1 hook scope itself — the shellCommand text and tool-form
// file writes — not just the self-test marker fixtures. A bypass that only
// the markers see is dead at runtime.
import { strict as assert } from "node:assert";
import test from "node:test";
import type {
	CheckContext,
	Enforcer,
} from "../../../src/features/engine/index.ts";
import { resolveNoBypass } from "../../../src/features/packs/enforcers/integrity-guards-repo.ts";
import type { PackRule, Result } from "../../../src/kernel/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";
import { createFakePorts } from "../../support/fake-ports.ts";

function ruleFor(): PackRule {
	return {
		id: "core/no-bypass",
		family: "test",
		tier: "floor",
		statement: "a rule",
		reason: "testing",
		remediation: "run without the bypass (§4.14.3)",
		enforcer: "test-enforcer",
		triggers: ["pre-tool"],
		scope: [],
		params: {},
		measureVersion: 1,
		fixtures: { violating: [], passing: [] },
	};
}

const DECL = { id: "test-enforcer", kind: "code", budgetMs: 1000 } as const;

function ctxFor(scope: CheckContext["scope"]): CheckContext {
	return {
		trigger: "pre-tool",
		scope,
		now: FIXED_INSTANT,
		configHash: "config-hash",
	};
}

function liveEnforcer(): Enforcer {
	const { ports } = createFakePorts();
	const resolved: Result<Enforcer> = resolveNoBypass(DECL, ruleFor(), ports);
	assert.equal(resolved.ok, true);
	if (!resolved.ok) {
		throw new Error("resolver failed");
	}
	return resolved.value;
}

test("[§4.14] L1 live shell command with --no-verify blocks", async () => {
	// SPEC §4.14.3: the enforcer evaluates scope.shellCommand, so a commit
	// that skips the gates blocks at L1, not just in marker fixtures.
	const findings = await liveEnforcer().check(
		ctxFor({ files: [], shellCommand: "git commit --no-verify -m x" }),
		{},
	);
	assert.ok(findings.some((finding) => finding.ruleId === "core/no-bypass"));
});

test("[§4.14] L1 live wrapped bypass blocks through the shell text", async () => {
	// SPEC §4.14.6 EC-8: wrappers do not hide the bypass from the live
	// enforcer either (`bash -c` payloads ride scope.shellCommand as text).
	const findings = await liveEnforcer().check(
		ctxFor({ files: [], shellCommand: "bash -c 'git commit -n -m x'" }),
		{},
	);
	assert.ok(findings.some((finding) => finding.ruleId === "core/no-bypass"));
});

test("[§4.14] L1 live HUSKY=0 assignment blocks via the raw-text path", async () => {
	// SPEC §4.14.3: env-prefix stripping hides the assignment from the
	// structured parse, so the raw-text backstop must still fire live.
	const findings = await liveEnforcer().check(
		ctxFor({ files: [], shellCommand: "HUSKY=0 git commit -m x" }),
		{},
	);
	assert.ok(findings.some((finding) => finding.ruleId === "core/no-bypass"));
});

test("[§4.14] L1 live tool write of a guardrail path blocks", async () => {
	// SPEC §4.14.3 target rows: a tool-form write carries proposed content,
	// so proposed paths are write targets and guardrail paths block.
	const findings = await liveEnforcer().check(
		ctxFor({
			files: [],
			proposedContent: "hook text",
			proposedPaths: [".githooks/pre-commit"],
		}),
		{},
	);
	assert.ok(findings.some((finding) => finding.ruleId === "core/no-bypass"));
});

test("[§4.14] L1 live read of a guardrail path allows", async () => {
	// SPEC §4.14.3: reads carry no proposed content, so the same path
	// without a write stays allowed; L0 still needs reads for regen.
	const findings = await liveEnforcer().check(
		ctxFor({ files: [], proposedPaths: [".codictator/config.json"] }),
		{},
	);
	assert.equal(findings.length, 0);
});

test("[§4.14] L1 live benign shell allows", async () => {
	// SPEC §4.14.3: ordinary commands are not bypasses.
	const findings = await liveEnforcer().check(
		ctxFor({ files: [], shellCommand: "git status" }),
		{},
	);
	assert.equal(findings.length, 0);
});
