import { strict as assert } from "node:assert";

import test from "node:test";

import type {
	CheckContext,
	Enforcer,
} from "../../../src/features/engine/index.ts";

import { resolveNoSecretReads } from "../../../src/features/packs/enforcers/secret-scan.ts";

import { resolveWriteConfinement } from "../../../src/features/packs/enforcers/write-confine.ts";
import type { PackRule, Ports, Result } from "../../../src/kernel/index.ts";

import { FIXED_INSTANT } from "../../support/fake-clock.ts";

import { FakeFs } from "../../support/fake-fs.ts";

import { createFakePorts } from "../../support/fake-ports.ts";

function ruleFor(id: string): PackRule {
	return {
		id,
		family: "test",
		tier: "floor",
		statement: "a rule",
		reason: "testing",
		remediation: "fix it",
		enforcer: "test-enforcer",
		triggers: ["pre-tool"],
		scope: [],
		params: {},
		measureVersion: 1,
		fixtures: { violating: [], passing: [] },
	};
}

const DECL = { id: "test-enforcer", kind: "code", budgetMs: 1000 } as const;

function ctxForProposed(targets: ReadonlyArray<string>): CheckContext {
	return {
		trigger: "pre-tool",
		scope: { files: [], proposedPaths: [...targets] },
		now: FIXED_INSTANT,
		configHash: "test-hash",
	};
}

// The L1 proposed-target check must never touch the disk: a not-yet-existing
// benign path would otherwise fail closed on realpath. Any port read throws.
class NoReadFs extends FakeFs {
	override read(_path: string): Promise<Result<Uint8Array>> {
		throw new Error("proposed targets must not read the disk");
	}
	override readText(_path: string): Promise<Result<string>> {
		throw new Error("proposed targets must not read the disk");
	}
	override exists(_path: string): Promise<Result<boolean>> {
		throw new Error("proposed targets must not read the disk");
	}
	override realpath(_path: string): Promise<Result<string>> {
		throw new Error("proposed targets must not read the disk");
	}
}

function noReadPorts(): Ports {
	const { ports } = createFakePorts();
	return { ...ports, fs: new NoReadFs() };
}

function checked(
	resolved: Result<Enforcer>,
): (ctx: CheckContext) => Promise<number> {
	assert.equal(resolved.ok, true);
	if (!resolved.ok) {
		throw new Error("resolver failed");
	}
	const enforcer = resolved.value;
	return async (ctx: CheckContext): Promise<number> => {
		const findings = await enforcer.check(ctx, {});
		return findings.filter(
			(finding) => finding.ruleId === "core/write-confinement",
		).length;
	};
}

test("[§4.7.3] L1 proposed write target outside root blocks with no disk read", async () => {
	const count = checked(
		resolveWriteConfinement(
			DECL,
			ruleFor("core/write-confinement"),
			noReadPorts(),
		),
	);
	assert.equal(await count(ctxForProposed(["../outside.txt"])), 1);
});

test("[§4.7.3] L1 benign proposed write target allows with no disk read", async () => {
	const count = checked(
		resolveWriteConfinement(
			DECL,
			ruleFor("core/write-confinement"),
			noReadPorts(),
		),
	);
	assert.equal(await count(ctxForProposed(["src/ok.ts"])), 0);
});

test("[§4.7.3] L1 proposed .git write target blocks", async () => {
	const count = checked(
		resolveWriteConfinement(
			DECL,
			ruleFor("core/write-confinement"),
			noReadPorts(),
		),
	);
	assert.equal(await count(ctxForProposed([".git/config"])), 1);
});

test("[§4.7.1] L1 proposed read target of a secret path blocks", async () => {
	const resolved = resolveNoSecretReads(
		DECL,
		ruleFor("core/no-secret-reads"),
		noReadPorts(),
	);
	assert.equal(resolved.ok, true);
	if (!resolved.ok) {
		return;
	}
	const secret = await resolved.value.check(ctxForProposed([".env"]), {});
	assert.equal(
		secret.filter((finding) => finding.ruleId === "core/no-secret-reads")
			.length,
		1,
	);
	const benign = await resolved.value.check(ctxForProposed(["src/ok.ts"]), {});
	assert.equal(
		benign.filter((finding) => finding.ruleId === "core/no-secret-reads")
			.length,
		0,
	);
});
