// Shared harness for the write-confinement unit tests: runs the real
// enforcer over a seeded file on a filesystem that, like a real one, cannot
// resolve a path that does not exist.
import { strict as assert } from "node:assert";
import type { CheckContext, Finding } from "../../src/features/engine/index.ts";
import { resolveWriteConfinement } from "../../src/features/packs/enforcers/write-confine.ts";
import type { PackRule } from "../../src/features/packs/index.ts";
import { err, makeError, type Result } from "../../src/kernel/index.ts";
import { FIXED_INSTANT } from "./fake-clock.ts";
import { FakeFs } from "./fake-fs.ts";
import { createFakePorts } from "./fake-ports.ts";

// A real filesystem cannot resolve a path that does not exist: only the
// seeded files resolve.
class StrictFs extends FakeFs {
	private readonly known = new Set<string>();

	override seedText(path: string, text: string): void {
		this.known.add(path);
		super.seedText(path, text);
	}

	override realpath(path: string): Promise<Result<string>> {
		return this.known.has(path)
			? super.realpath(path)
			: Promise.resolve(
					err(
						makeError("CDX-E903", `no such path ${path}`, "Create it first."),
					),
				);
	}
}

function ruleFor(id: string): PackRule {
	return {
		id,
		family: "F2",
		tier: "floor",
		statement: "s",
		reason: "r",
		remediation: "fix {path}",
		enforcer: id,
		triggers: ["pre-tool"],
		scope: [],
		params: {},
		measureVersion: 1,
		fixtures: { violating: [], passing: [] },
	};
}

export async function judge(
	text: string,
	file: string,
	proposed: ReadonlyArray<string> = [],
): Promise<Array<Finding>> {
	const fs = new StrictFs();
	fs.seedText(file, text);
	const ports = { ...createFakePorts().ports, fs };
	const decl = { id: "enf", kind: "code", budgetMs: 1000, args: {} } as const;
	const resolved = resolveWriteConfinement(
		decl,
		ruleFor("core/write-confinement"),
		ports,
	);
	assert.ok(resolved.ok);
	const ctx: CheckContext = {
		trigger: "pre-tool",
		scope: { files: [file], proposedPaths: proposed },
		now: FIXED_INSTANT,
		configHash: "t",
	};
	return resolved.value.check(ctx);
}
