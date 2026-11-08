// SPEC §4.6.3: prompt.submit resends the L0 injection only when its hash
// differs from the last injection in the session. Split from
// hook-injection-l0.test.ts (CONVENTIONS file size); the startup and
// Claude shaping cases stay there, the prompt dedupe pair lives here.
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
	// R1-01: the stub append writes the real log file, or the
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

function injectionLine(session: string, message: string): string {
	return `${JSON.stringify({
		v: 1,
		id: "20260101T000000-abcdef012345",
		ts: "2026-01-01T00:00:00.000Z",
		now: "2026-01-01T00:00:00.000Z",
		kind: "injection",
		layer: "L0",
		trigger: "prompt",
		ruleIds: [],
		durationMs: 0,
		configHash: "config-hash",
		packs: {},
		sessionId: session,
		message,
	})}\n`;
}

interface L0Reply {
	readonly decision?: unknown;
	readonly additionalContext?: unknown;
	readonly hookSpecificOutput?: unknown;
}

function replyJson(reply: { readonly stdout: string }): L0Reply {
	return JSON.parse(reply.stdout) as L0Reply;
}

test("[§4.6.3] prompt.submit resends additionalContext only on state change", async () => {
	// The first prompt sends the injection; a second prompt over unchanged
	// state omits it, and changed state sends it again.
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
		const first: Array<unknown> = [];
		const one = await runHookEvent(
			requestFor(
				repo,
				"prompt.submit",
				promptPayload(repo.dir, "session-3"),
				first,
			),
		);
		const sent = replyJson(one).additionalContext as string;
		assert.ok(typeof sent === "string" && sent.includes("T-0099"));
		repo.writeFile(
			".codictator/state/events.jsonl",
			injectionLine("session-3", sent),
		);
		const second: Array<unknown> = [];
		const two = await runHookEvent(
			requestFor(
				repo,
				"prompt.submit",
				promptPayload(repo.dir, "session-3"),
				second,
			),
		);
		assert.ok(!("additionalContext" in replyJson(two)));
		repo.writeFile(
			".codictator/state/events.jsonl",
			injectionLine("session-3", "stale injection"),
		);
		const third: Array<unknown> = [];
		const three = await runHookEvent(
			requestFor(
				repo,
				"prompt.submit",
				promptPayload(repo.dir, "session-3"),
				third,
			),
		);
		assert.ok(
			(replyJson(three).additionalContext as string).includes("T-0099"),
		);
	} finally {
		repo.cleanup();
	}
});

test("[§4.6.3] prompt.submit first send carries additionalContext with real-log append (R1-01)", async () => {
	// R1-01: the stub append writes the real events.jsonl, so a buggy
	// append-then-compare order suppresses the first prompt reply. The
	// fixed reply-before-append order sends on the first prompt and omits
	// only the unchanged second prompt.
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
		const first: Array<unknown> = [];
		const one = await runHookEvent(
			requestFor(
				repo,
				"prompt.submit",
				promptPayload(repo.dir, "session-r1-01"),
				first,
			),
		);
		assert.equal(one.exitCode, 0);
		const sent = replyJson(one).additionalContext;
		assert.equal(typeof sent, "string");
		assert.ok((sent as string).includes("T-0099"));
		const second: Array<unknown> = [];
		const two = await runHookEvent(
			requestFor(
				repo,
				"prompt.submit",
				promptPayload(repo.dir, "session-r1-01"),
				second,
			),
		);
		assert.equal(two.exitCode, 0);
		assert.ok(!("additionalContext" in replyJson(two)));
	} finally {
		repo.cleanup();
	}
});
