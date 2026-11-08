import { strict as assert } from "node:assert";

import path from "node:path";

import test from "node:test";

import {
	type HookRunRequest,
	runHookEvent,
} from "../../../src/features/adapters/index.ts";

import type {
	Enforcer,
	WaiverStore,
} from "../../../src/features/engine/index.ts";

import { resolveNoSecretReads } from "../../../src/features/packs/enforcers/secret-scan.ts";

import { resolveWriteConfinement } from "../../../src/features/packs/enforcers/write-confine.ts";

import type { EnforcerDecl } from "../../../src/features/packs/manifest.ts";

import type { PackRule } from "../../../src/kernel/index.ts";

import { ok, type Ports, type Result } from "../../../src/kernel/index.ts";

import { createFakePorts } from "../../support/fake-ports.ts";

import { createTempRepo, type TempRepo } from "../../support/temp-repo.ts";

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

function stubLoader(ports: Ports): Promise<
	Result<{
		readonly enforcers: ReadonlyArray<Enforcer>;
		readonly waiverStore: WaiverStore;
	}>
> {
	const decl: EnforcerDecl = DECL;
	const confined = resolveWriteConfinement(
		decl,
		ruleFor("core/write-confinement"),
		ports,
	);
	const secrets = resolveNoSecretReads(
		decl,
		ruleFor("core/no-secret-reads"),
		ports,
	);
	assert.equal(confined.ok, true);
	assert.equal(secrets.ok, true);
	if (!confined.ok || !secrets.ok) {
		throw new Error("stub enforcers failed to resolve");
	}
	return Promise.resolve(
		ok({
			enforcers: [confined.value, secrets.value],
			waiverStore: { waivers: [], tiers: {}, maxWaiverDays: 90 },
		}),
	);
}

function requestFor(
	repo: TempRepo,
	harness: string,
	event: string,
	payload: unknown,
): HookRunRequest {
	const { ports, proc } = createFakePorts();
	proc.when(["git", "rev-parse", "--show-toplevel"], {
		code: 0,
		stdout: `${repo.dir}\n`,
		stderr: "",
		timedOut: false,
		truncated: false,
	});
	return {
		harness,
		event,
		stdinText: JSON.stringify(payload),
		cwd: repo.dir,
		ports: { proc, net: ports.net, clock: ports.clock, env: ports.env },
		append: async () => ok(undefined),
		loadEnforcers: stubLoader,
	};
}

function musePayload(
	toolName: string,
	toolInput: unknown,
	cwd: string,
): unknown {
	return {
		session_id: "session-1",
		cwd,
		hook_event_name: "PreToolUse",
		tool_name: toolName,
		tool_input: toolInput,
	};
}

async function hookDecision(
	repo: TempRepo,
	harness: string,
	event: string,
	payload: unknown,
): Promise<{ readonly decision: string; readonly text: string }> {
	const reply = await runHookEvent(requestFor(repo, harness, event, payload));
	assert.equal(reply.exitCode, 0);
	const text = reply.stdout;
	if (harness === "muse-code") {
		if (text === "{}") {
			return { decision: "allow", text };
		}
		const parsed: unknown = JSON.parse(text);
		const specific = (parsed as { hookSpecificOutput?: unknown })
			.hookSpecificOutput as
			| {
					permissionDecision?: unknown;
					permissionDecisionReason?: unknown;
			  }
			| undefined;
		return {
			decision: String(specific?.permissionDecision ?? "unknown"),
			text: String(specific?.permissionDecisionReason ?? text),
		};
	}
	const parsed: unknown = JSON.parse(text);
	const record = parsed as { decision?: unknown; message?: unknown };
	return {
		decision: String(record.decision ?? "unknown"),
		text: String(record.message ?? text),
	};
}

function tempRepoWithConfig(): TempRepo {
	return createTempRepo({
		".codictator/config.json": JSON.stringify({
			version: 1,
			codictator: "unknown",
			packs: [],
			harnesses: ["muse-code", "opencode"],
		}),
	});
}

test("[§4.7] L1 hook allows an absolute in-root write target", async () => {
	const repo = tempRepoWithConfig();
	try {
		const inside = path.join(repo.dir, "src", "ok.ts");
		const verdict = await hookDecision(
			repo,
			"muse-code",
			"PreToolUse",
			musePayload(
				"Write",
				{ file_path: inside, content: "export const x = 1;\n" },
				repo.dir,
			),
		);
		assert.equal(verdict.decision, "allow");
	} finally {
		repo.cleanup();
	}
});

test("[§4.7] L1 hook allows a benign in-root write", async () => {
	const repo = tempRepoWithConfig();
	try {
		const verdict = await hookDecision(
			repo,
			"muse-code",
			"PreToolUse",
			musePayload(
				"Write",
				{ file_path: "src/ok.ts", content: "export const x = 1;\n" },
				repo.dir,
			),
		);
		assert.equal(verdict.decision, "allow");
	} finally {
		repo.cleanup();
	}
});

test("[§4.7] L1 hook allows a benign in-root read", async () => {
	const repo = tempRepoWithConfig();
	try {
		const verdict = await hookDecision(
			repo,
			"muse-code",
			"PreToolUse",
			musePayload("Read", { file_path: "src/ok.ts" }, repo.dir),
		);
		assert.equal(verdict.decision, "allow");
	} finally {
		repo.cleanup();
	}
});
