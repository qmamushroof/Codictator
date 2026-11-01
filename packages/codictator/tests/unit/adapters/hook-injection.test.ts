// SPEC §4.18.3 + §4.6.3: the live hook path renders the scoped injection
// and lands the auditable kind:"injection" event through the existing
// append port, so the status row reads live evidence instead of missing.
// The emission mirrors buildInjectionEvent (audit owns the constructor;
// adapters never import audit, so the literal is structural and the first
// test pins them equal).
import { strict as assert } from "node:assert";
import test from "node:test";
import type { HookEvent } from "../../../src/features/adapters/contract.ts";
import { emitInjectionEvent } from "../../../src/features/adapters/hook-injection.ts";
import type { HookAppend } from "../../../src/features/adapters/runtime.ts";
import {
	buildInjectionEvent,
	type NewEvent,
} from "../../../src/features/audit/index.ts";
import type { Result, Scope } from "../../../src/kernel/index.ts";
import { err, makeError, ok } from "../../../src/kernel/index.ts";

const CONFIG_HASH = "config-hash";
const ROOT = "repo";

function hookEvent(trigger: HookEvent["trigger"]): HookEvent {
	return {
		harness: "opencode",
		event: "prompt.submit",
		trigger,
		sessionId: "session-1",
		cwd: "",
		usage: { contextTokens: 65000, contextWindow: 100000 },
	};
}

function scope(): Scope {
	return { files: [], sessionId: "session-1" };
}

function hookEventWithoutUsage(trigger: HookEvent["trigger"]): HookEvent {
	return {
		harness: "opencode",
		event: "prompt.submit",
		trigger,
		sessionId: "session-1",
		cwd: "",
	};
}

function recordingAppend(
	seen: Array<NewEvent>,
): HookAppend & { readonly seen: Array<NewEvent> } {
	const append: HookAppend = async (
		_root: string,
		event: Parameters<HookAppend>[1],
	): Promise<Result<void>> => {
		seen.push(event);
		return ok(undefined);
	};
	return Object.assign(append, { seen });
}

test("[§4.18.3] live render appends an injection event carrying the band line", async () => {
	// SPEC §4.18.3 + §4.6.3: each L0 trigger (startup, compact, prompt)
	// renders the scoped injection from live usage and appends the
	// auditable event; the structural literal matches the audit-owned
	// constructor exactly.
	for (const trigger of ["startup", "compact", "prompt"] as const) {
		const seen: Array<NewEvent> = [];
		const append = recordingAppend(seen);
		const emitted = await emitInjectionEvent({
			event: hookEvent(trigger),
			scope: scope(),
			steering: {},
			configHash: CONFIG_HASH,
			root: ROOT,
			append,
		});
		assert.equal(emitted.ok, true);
		assert.equal(seen.length, 1);
		const line = seen[0];
		assert.equal(line?.kind, "injection");
		assert.equal(line?.layer, "L0");
		assert.equal(line?.trigger, trigger);
		assert.equal(line?.harness, "opencode");
		assert.equal(line?.sessionId, "session-1");
		assert.ok(
			line?.message?.includes("Budget: amber (65000/100000 tokens used)."),
		);
		assert.deepEqual(
			line,
			buildInjectionEvent({
				content: line?.message ?? "",
				trigger,
				harness: "opencode",
				sessionId: "session-1",
				configHash: CONFIG_HASH,
			}),
		);
	}
});

test("[§4.6.7 EC-4] injection without usage carries an unavailable band", async () => {
	// SPEC §4.6.7 EC-4: without usage data the band is unevaluated and the
	// budget line reports unavailable, never an estimate; a configured
	// window alone still estimates nothing without used tokens.
	for (const steering of [{}, { contextWindow: 100000 }]) {
		const seen: Array<NewEvent> = [];
		const append = recordingAppend(seen);
		const emitted = await emitInjectionEvent({
			event: hookEventWithoutUsage("prompt"),
			scope: scope(),
			steering,
			configHash: CONFIG_HASH,
			root: ROOT,
			append,
		});
		assert.equal(emitted.ok, true);
		assert.equal(seen.length, 1);
		assert.ok(
			seen[0]?.message?.includes("Budget: unavailable (no usage data)."),
		);
	}
});

test("[§4.6.3] non-injection triggers render nothing and append nothing", async () => {
	// SPEC §4.6.3: the injection renders on session start, after compaction
	// and on prompt submit only; tool triggers carry no injection event.
	const seen: Array<NewEvent> = [];
	const append = recordingAppend(seen);
	const emitted = await emitInjectionEvent({
		event: hookEvent("pre-tool"),
		scope: scope(),
		steering: {},
		configHash: CONFIG_HASH,
		root: ROOT,
		append,
	});
	assert.equal(emitted.ok, true);
	assert.equal(emitted.value, false);
	assert.equal(seen.length, 0);
});

test("[§4.18.1] injection append failure propagates fail-closed", async () => {
	// SPEC §4.18.1: an unwritable event log fails the hook closed, so the
	// runtime blocks CDX-E801 instead of allowing without evidence.
	const failing: HookAppend = () =>
		Promise.resolve(
			err(
				makeError(
					"CDX-E801",
					"event log not writable: cannot append event",
					"Free disk space and fix permissions on .codictator/state/, then retry.",
				),
			),
		);
	const emitted = await emitInjectionEvent({
		event: hookEvent("prompt"),
		scope: scope(),
		steering: {},
		configHash: CONFIG_HASH,
		root: ROOT,
		append: failing,
	});
	assert.equal(emitted.ok, false);
	if (emitted.ok) {
		throw new Error("expected the injection append to fail");
	}
	assert.equal(emitted.error.code, "CDX-E801");
});
