// SPEC §4.6.5 + §7.8: the hook entry loads the session's read cache from
// `.codictator/state/sessions/<sessionId>/reads.jsonl`, hands the targets it
// already holds unchanged to the engine on the scope, and appends one line
// per allowed read (BUG-0106).
import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import type { HookRunRequest } from "../../../src/features/adapters/index.ts";
import { runHookEvent } from "../../../src/features/adapters/index.ts";
import type { Enforcer, Scope } from "../../../src/features/engine/index.ts";
import { ok } from "../../../src/kernel/index.ts";
import { createFakePorts } from "../../support/fake-ports.ts";
import { createTempRepo, type TempRepo } from "../../support/temp-repo.ts";

function requestFor(
	repo: TempRepo,
	payload: unknown,
	scopes: Array<Scope>,
): HookRunRequest {
	const { ports, proc } = createFakePorts();
	proc.when(["git", "rev-parse", "--show-toplevel"], {
		code: 0,
		stdout: `${repo.dir}\n`,
		stderr: "",
		timedOut: false,
		truncated: false,
	});
	const capture: Enforcer = {
		id: "test/capture",
		kinds: ["pre-tool"],
		budgetMs: 1000,
		check: (ctx) => {
			scopes.push(ctx.scope);
			return Promise.resolve([]);
		},
	};
	return {
		harness: "muse-code",
		event: "PreToolUse",
		stdinText: JSON.stringify(payload),
		cwd: repo.dir,
		ports: { proc, net: ports.net, clock: ports.clock, env: ports.env },
		append: () => Promise.resolve(ok(undefined)),
		loadEnforcers: () =>
			Promise.resolve(
				ok({
					enforcers: [capture],
					waiverStore: { waivers: [], tiers: {}, maxWaiverDays: 90 },
				}),
			),
	};
}

function readPayload(
	repo: TempRepo,
	session: string,
	extra: Record<string, unknown> = {},
): unknown {
	return {
		session_id: session,
		cwd: repo.dir,
		hook_event_name: "PreToolUse",
		tool_name: "Read",
		tool_input: { file_path: path.join(repo.dir, "src/a.ts"), ...extra },
		tool_use_id: "toolu-1",
	};
}

async function readTwice(
	repo: TempRepo,
	session: string,
): Promise<Array<Scope>> {
	const scopes: Array<Scope> = [];
	for (let call = 0; call < 2; call += 1) {
		await runHookEvent(requestFor(repo, readPayload(repo, session), scopes));
	}
	return scopes;
}

const CONFIG = JSON.stringify({
	version: 1,
	codictator: "unknown",
	packs: [],
	harnesses: ["muse-code"],
});

function seeded(): TempRepo {
	return createTempRepo({
		".codictator/config.json": CONFIG,
		"src/a.ts": "export const a = 1;\n",
	});
}

test("[§4.6.5] the second read of an unchanged file in a session reaches the engine as a repeat", async () => {
	const repo = seeded();
	try {
		const scopes = await readTwice(repo, "s1");
		assert.equal(scopes[0]?.repeatReads, undefined);
		assert.deepEqual(scopes[1]?.repeatReads, [{ path: "src/a.ts", call: 1 }]);
	} finally {
		repo.cleanup();
	}
});

test("[§4.6.7 EC-9] a read of a file modified since the last read is not a repeat", async () => {
	const repo = seeded();
	try {
		const scopes: Array<Scope> = [];
		await runHookEvent(requestFor(repo, readPayload(repo, "s1"), scopes));
		writeFileSync(path.join(repo.dir, "src/a.ts"), "export const a = 2;\n");
		await runHookEvent(requestFor(repo, readPayload(repo, "s1"), scopes));
		assert.equal(scopes[1]?.repeatReads, undefined);
	} finally {
		repo.cleanup();
	}
});

test("[§4.6.7 EC-10] a read of another range is a repeat only when an earlier range contains it", async () => {
	const repo = seeded();
	try {
		const scopes: Array<Scope> = [];
		const range = (offset: number, limit: number) =>
			readPayload(repo, "s1", { offset, limit });
		for (const [offset, limit] of [
			[0, 10],
			[2, 3],
			[8, 10],
		] as const) {
			await runHookEvent(requestFor(repo, range(offset, limit), scopes));
		}
		assert.equal(scopes[1]?.repeatReads?.length, 1);
		assert.equal(scopes[2]?.repeatReads, undefined);
	} finally {
		repo.cleanup();
	}
});

test("[§4.6.5] a new session id starts with an empty read cache", async () => {
	const repo = seeded();
	try {
		const scopes: Array<Scope> = [];
		await runHookEvent(requestFor(repo, readPayload(repo, "s1"), scopes));
		await runHookEvent(requestFor(repo, readPayload(repo, "s2"), scopes));
		assert.equal(scopes[1]?.repeatReads, undefined);
	} finally {
		repo.cleanup();
	}
});
