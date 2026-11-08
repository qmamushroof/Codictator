// SPEC §4.6.3: L0 hook replies carry additionalContext built from
// committed state, with the active task summary; prompt.submit resends it
// only when its hash differs from the last injection in the session.
import { strict as assert } from "node:assert";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import type { HookRunRequest } from "../../../src/features/adapters/index.ts";
import { runHookEvent } from "../../../src/features/adapters/index.ts";
import type {
	Enforcer,
	WaiverStore,
} from "../../../src/features/engine/index.ts";
import type { Ports, Result } from "../../../src/kernel/index.ts";
import { ok } from "../../../src/kernel/index.ts";
import { createFakePorts } from "../../support/fake-ports.ts";
import { createTempRepo, type TempRepo } from "../../support/temp-repo.ts";

const BRANCH = "fix/consumer-slice2-l0";

const TASK_RECORD = {
	version: 1,
	id: "T-0099",
	type: "feature",
	title: "slice2 probe",
	branch: BRANCH,
	phase: "planning",
	phases: [],
	spec: ["docs/SPEC/04-06-STEERING.md"],
	acceptanceCriteria: ["probe"],
	files: { allow: ["packages/codictator/src/**"] },
};

function stubLoader(_ports: Ports): Promise<
	Result<{
		readonly enforcers: ReadonlyArray<Enforcer>;
		readonly waiverStore: WaiverStore;
	}>
> {
	const allow: Enforcer = {
		id: "test/allow",
		kinds: ["startup", "compact", "prompt"],
		budgetMs: 1000,
		check: () => Promise.resolve([]),
	};
	return Promise.resolve(
		ok({
			enforcers: [allow],
			waiverStore: { waivers: [], tiers: {}, maxWaiverDays: 90 },
		}),
	);
}

function appendRealLog(repoDir: string, line: unknown): void {
	// R1-01: the stub append must write the real log file, or the
	// prompt.submit dedupe (which reads events.jsonl) never sees the
	// just-appended injection and the test masks the append-then-compare
	// ordering bug.
	const full = path.join(repoDir, ".codictator/state/events.jsonl");
	mkdirSync(path.dirname(full), { recursive: true });
	appendFileSync(full, `${JSON.stringify(line)}\n`, "utf8");
}

function requestFor(
	repo: TempRepo,
	event: string,
	payload: unknown,
	seen: Array<unknown>,
): HookRunRequest {
	const { ports, proc } = createFakePorts();
	proc.when(["git", "rev-parse", "--show-toplevel"], {
		code: 0,
		stdout: `${repo.dir}\n`,
		stderr: "",
		timedOut: false,
		truncated: false,
	});
	proc.when(["git", "branch", "--show-current"], {
		code: 0,
		stdout: `${BRANCH}\n`,
		stderr: "",
		timedOut: false,
		truncated: false,
	});
	return {
		harness: "opencode",
		event,
		stdinText: JSON.stringify(payload),
		cwd: repo.dir,
		ports: { proc, net: ports.net, clock: ports.clock, env: ports.env },
		append: async (_root: string, line: unknown) => {
			seen.push(line);
			appendRealLog(repo.dir, line);
			return ok(undefined);
		},
		loadEnforcers: stubLoader,
	};
}

function promptPayload(cwd: string, session: string): unknown {
	return { sessionID: session, cwd, type: "prompt.submit" };
}

interface L0Reply {
	readonly decision?: unknown;
	readonly additionalContext?: unknown;
	readonly hookSpecificOutput?: unknown;
}

function replyJson(reply: { readonly stdout: string }): L0Reply {
	return JSON.parse(reply.stdout) as L0Reply;
}

test("[§4.6.3] startup reply carries additionalContext with the active task", async () => {
	// G3: the scoped injection is sent, with the task summary built from
	// the active task for the branch (id, phase, next gate and command).
	const repo = createTempRepo({
		".codictator/config.json": JSON.stringify({
			version: 1,
			codictator: "unknown",
			packs: [],
			harnesses: ["opencode"],
		}),
		".codictator/tasks/T-0099.json": JSON.stringify(TASK_RECORD),
	});
	try {
		const seen: Array<unknown> = [];
		const reply = await runHookEvent(
			requestFor(
				repo,
				"session.start",
				promptPayload(repo.dir, "session-1"),
				seen,
			),
		);
		assert.equal(reply.exitCode, 0);
		const body = replyJson(reply);
		const context = body.additionalContext;
		assert.equal(typeof context, "string");
		assert.ok((context as string).includes("T-0099"));
		assert.ok((context as string).includes("planning"));
		assert.ok((context as string).includes("codictator test red"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.6.3] startup with no active task carries task-new instructions", async () => {
	// SPEC §4.6.3: with no active task the injection is the precedence
	// statement plus task-new instructions.
	const repo = createTempRepo({
		".codictator/config.json": JSON.stringify({
			version: 1,
			codictator: "unknown",
			packs: [],
			harnesses: ["opencode"],
		}),
	});
	try {
		const seen: Array<unknown> = [];
		const reply = await runHookEvent(
			requestFor(
				repo,
				"session.start",
				promptPayload(repo.dir, "session-2"),
				seen,
			),
		);
		assert.equal(reply.exitCode, 0);
		const body = replyJson(reply);
		assert.ok(
			(body.additionalContext as string).includes("codictator task new"),
		);
	} finally {
		repo.cleanup();
	}
});

test("[§4.6.3] claude startup reply carries hookSpecificOutput.additionalContext", async () => {
	// The Claude adapter shapes additionalContext as hookSpecificOutput
	// (§4.5.4); the OpenCode wire carries it beside the decision.
	const repo = createTempRepo({
		".codictator/config.json": JSON.stringify({
			version: 1,
			codictator: "unknown",
			packs: [],
			harnesses: ["claude-code"],
		}),
		".codictator/tasks/T-0099.json": JSON.stringify(TASK_RECORD),
	});
	try {
		const { ports, proc } = createFakePorts();
		proc.when(["git", "rev-parse", "--show-toplevel"], {
			code: 0,
			stdout: `${repo.dir}\n`,
			stderr: "",
			timedOut: false,
			truncated: false,
		});
		proc.when(["git", "branch", "--show-current"], {
			code: 0,
			stdout: `${BRANCH}\n`,
			stderr: "",
			timedOut: false,
			truncated: false,
		});
		const seen: Array<unknown> = [];
		const reply = await runHookEvent({
			harness: "claude-code",
			event: "SessionStart",
			stdinText: JSON.stringify({ session_id: "session-9", cwd: repo.dir }),
			cwd: repo.dir,
			ports: { proc, net: ports.net, clock: ports.clock, env: ports.env },
			append: async (_root: string, line: unknown) => {
				seen.push(line);
				appendRealLog(repo.dir, line);
				return ok(undefined);
			},
			loadEnforcers: stubLoader,
		});
		assert.equal(reply.exitCode, 0);
		const body = replyJson(reply).hookSpecificOutput as {
			additionalContext?: unknown;
		};
		assert.ok(typeof body?.additionalContext === "string");
		assert.ok(
			(body.additionalContext as string).includes("codictator test red"),
		);
	} finally {
		repo.cleanup();
	}
});
