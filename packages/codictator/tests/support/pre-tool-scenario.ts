// Shared scope and rule builders for the pre-tool file adapter unit files
// (SPEC §4.3.2): whole-file write, edit fragment and read scopes as the
// hook scope shapes them.
import { strict as assert } from "node:assert";
import type {
	CheckContext,
	Enforcer,
	Finding,
	Scope,
} from "../../src/features/engine/index.ts";
import type { PackRule, Ports, Result } from "../../src/kernel/index.ts";
import { FIXED_INSTANT } from "./fake-clock.ts";
import type { FakeFs } from "./fake-fs.ts";
import { FakeGit } from "./fake-git.ts";
import { createFakePorts } from "./fake-ports.ts";

export const DECL = {
	id: "test-enforcer",
	kind: "code",
	budgetMs: 1000,
} as const;

export function ruleFor(id: string): PackRule {
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

export function checked(resolved: Result<Enforcer>): Enforcer {
	assert.equal(resolved.ok, true);
	if (!resolved.ok) {
		throw new Error("resolver failed");
	}
	return resolved.value;
}

export function ctxFor(scope: Scope): CheckContext {
	return {
		trigger: "pre-tool",
		scope,
		now: FIXED_INSTANT,
		configHash: "test-hash",
	};
}

// A whole-file write, an edit fragment and a read, as the hook scope shapes
// them: only the whole write carries a complete file.
export function writeScope(path: string, content: string): Scope {
	return {
		files: [],
		proposedPaths: [path],
		proposedContent: content,
		proposedContentWhole: true,
		toolAccess: "write",
	};
}

export function editScope(path: string, fragment: string): Scope {
	return {
		files: [],
		proposedPaths: [path],
		proposedContent: fragment,
		toolAccess: "write",
	};
}

export function readScope(path: string): Scope {
	return { files: [], proposedPaths: [path], toolAccess: "read" };
}

export function ruleIds(findings: ReadonlyArray<Finding>): Array<string> {
	return findings.map((finding) => finding.ruleId);
}

export function portsWith(fs: FakeFs, git: FakeGit = new FakeGit()): Ports {
	return { ...createFakePorts().ports, fs, git };
}
