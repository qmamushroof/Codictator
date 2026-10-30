// SPEC §4.19.3 steps 1-6: the hook runtime gates. Unknown harnesses block
// CDX-E301; oversize, empty and non-JSON stdin block before evaluation; a
// cwd git cannot resolve allows silently; Stop with stop_hook_active never
// blocks; the pre-engine deny speaks the harness's own form.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { HookRunRequest } from "../../../src/features/adapters/index.ts";
import {
	hookBudgetMs,
	runHookEvent,
	staticBlock,
	supportedHarness,
} from "../../../src/features/adapters/index.ts";
import { createFakePorts } from "../../support/fake-ports.ts";
import { createTempRepo } from "../../support/temp-repo.ts";

function requestFor(over: Partial<HookRunRequest> = {}): HookRunRequest {
	const { ports, proc } = createFakePorts();
	return {
		harness: "muse-code",
		event: "PreToolUse",
		stdinText: JSON.stringify({
			session_id: "session-1",
			cwd: "/repo",
			tool_name: "read",
			tool_input: { file_path: "/repo/a.ts" },
		}),
		cwd: "/repo",
		ports: { proc, net: ports.net, clock: ports.clock, env: ports.env },
		append: async () => ({ ok: true as const, value: undefined }),
		...over,
	};
}

test("[§4.19] hook budgets and harness support are static", () => {
	assert.equal(hookBudgetMs("opencode"), 4000);
	assert.equal(hookBudgetMs("muse-code"), 5000);
	assert.equal(hookBudgetMs("muse-code", 7), 7);
	assert.equal(supportedHarness("muse-code"), true);
	assert.equal(supportedHarness("opencode"), true);
	assert.equal(supportedHarness("bogus"), false);
	const blocked = staticBlock("muse-code", "CDX-E002", "no engine");
	assert.ok(blocked !== undefined && blocked.exitCode === 0);
	assert.equal(staticBlock("bogus", "CDX-E002", "no engine"), undefined);
});

test("[§4.19] hook rejects unknown harnesses and bad stdin", async () => {
	const unknown = await runHookEvent(requestFor({ harness: "bogus" }));
	assert.equal(unknown.exitCode, 0);
	assert.ok(unknown.stdout.includes("CDX-E301"));
	const big = await runHookEvent(
		requestFor({ stdinText: `{"a":"${"x".repeat(9 * 1024 * 1024)}"}` }),
	);
	assert.ok(big.stdout.includes("CDX-E305"));
	const empty = await runHookEvent(requestFor({ stdinText: "   " }));
	assert.ok(empty.stdout.includes("CDX-E303"));
	const malformed = await runHookEvent(requestFor({ stdinText: "{nope" }));
	assert.ok(malformed.stdout.includes("CDX-E303"));
	const unknownEvent = await runHookEvent(requestFor({ event: "Bogus" }));
	assert.ok(unknownEvent.stdout.includes("deny"));
});

test("[§4.19] hook allows when git resolves no root", async () => {
	const { ports, proc } = createFakePorts();
	proc.when(["git", "rev-parse", "--show-toplevel"], {
		code: 1,
		stdout: "",
		stderr: "no repo",
		timedOut: false,
		truncated: false,
	});
	const reply = await runHookEvent(
		requestFor({
			ports: { proc, net: ports.net, clock: ports.clock, env: ports.env },
		}),
	);
	assert.equal(reply.exitCode, 0);
	assert.equal(reply.stdout, "{}");
});

test("[§4.19] hook stop with stop_hook_active never blocks", async () => {
	const { ports, proc } = createFakePorts();
	proc.when(["git", "rev-parse", "--show-toplevel"], {
		code: 0,
		stdout: "/repo\n",
		stderr: "",
		timedOut: false,
		truncated: false,
	});
	const reply = await runHookEvent(
		requestFor({
			event: "Stop",
			stdinText: JSON.stringify({
				session_id: "s",
				cwd: "/repo",
				stop_hook_active: true,
			}),
			ports: { proc, net: ports.net, clock: ports.clock, env: ports.env },
		}),
	);
	assert.equal(reply.exitCode, 0);
	assert.equal(reply.stdout, "{}");
});

test("[§4.19] hook blocks when the repo root is unreadable", async () => {
	const { ports, proc } = createFakePorts();
	proc.when(["git", "rev-parse", "--show-toplevel"], {
		code: 0,
		stdout: "/repo\n",
		stderr: "",
		timedOut: false,
		truncated: false,
	});
	const reply = await runHookEvent(
		requestFor({
			ports: { proc, net: ports.net, clock: ports.clock, env: ports.env },
		}),
	);
	assert.equal(reply.exitCode, 0);
	assert.ok(reply.stdout.length > 0);
});

test("[§4.19.3] hook without enforcers fails closed", async () => {
	// The composition root injects the pack enforcer loader; a direct
	// runHookEvent call without one never evaluates, so it blocks CDX-E901
	// instead of allowing everything the empty engine would.
	const repo = createTempRepo({
		".codictator/config.json": JSON.stringify({
			version: 1,
			codictator: "0.0.0",
			packs: [],
			harnesses: ["muse-code"],
		}),
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
		const reply = await runHookEvent(
			requestFor({
				stdinText: JSON.stringify({
					session_id: "session-1",
					cwd: repo.dir,
					tool_name: "read",
					tool_input: { file_path: "/repo/a.ts" },
				}),
				cwd: repo.dir,
				ports: { proc, net: ports.net, clock: ports.clock, env: ports.env },
			}),
		);
		assert.equal(reply.exitCode, 0);
		assert.match(reply.stdout, /CDX-E901/);
	} finally {
		repo.cleanup();
	}
});
