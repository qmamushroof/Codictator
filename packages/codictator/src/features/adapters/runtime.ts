// SPEC §4.19.3 steps 1-6: the hook runtime. It lives in adapters (not cli/)
// because hook I/O translation is the adapter module's job (§3.3 table:
// adapters may import kernel, config, engine, steering); cli/ composes it
// with the audit append and the process sinks. Only the reply-capable
// harnesses dispatch here; universal parses fail-closed (no hook traffic)
// and every other unknown id stays CDX-E301. The loop breaker (§4.12.5)
// and steering injection (§4.6.3) run at step 5 once their phases land;
// until then the verdict decides. Split with hook-dispatch.ts (routing),
// hook-load.ts (root and config) and hook-scope.ts (L1 scope); this file
// keeps the public contract and the run composition.
import type {
	Clock,
	Env,
	Net,
	Ports,
	Proc,
	Result,
} from "../../kernel/index.ts";
import { NodeFs, NodeGit, parseJson } from "../../kernel/index.ts";
import type { Enforcer, EngineOptions } from "../engine/index.ts";
import { createEngine } from "../engine/index.ts";
import type { Adapter, HookReply } from "./contract.ts";
import { HOOK_PAYLOAD_MAX_BYTES } from "./contract.ts";
import {
	adapterFor,
	allowReply,
	blockReply,
	hookBudgetMs,
	stopHookActive,
	unknownHarnessReply,
} from "./hook-dispatch.ts";
import { emitInjectionEvent } from "./hook-injection.ts";
import {
	errorCodeOf,
	errorMessageOf,
	hookEnv,
	loadEffective,
	resolveRoot,
} from "./hook-load.ts";
import { hookScope } from "./hook-scope.ts";

// The caller passes the root-independent ports; the runtime confines an Fs
// to the resolved repo root itself (step 2), so nothing reads the disk
// before the root is known.
export interface HookBasePorts {
	readonly proc: Proc;
	readonly net: Net;
	readonly clock: Clock;
	readonly env: Env;
}

// SPEC §4.19.3 steps 3 and 5: the verdict append carries the audit line, but
// the repo root is only known after step 2, so the append takes the root
// with the event. cli/ owns audit (§3.3) and injects this; the event type
// rides on the engine options so adapters never import audit.
export type HookAppend = (
	repoRoot: string,
	event: Parameters<NonNullable<EngineOptions["append"]>>[0],
) => Promise<Result<void>>;

export interface HookRunRequest {
	readonly harness: string;
	readonly event: string;
	readonly stdinText: string;
	readonly cwd: string;
	readonly ports: HookBasePorts;
	readonly append: HookAppend;
	readonly budgetMs?: number;
	// SPEC §4.19.3: the real pack enforcers, resolved against root-confined
	// ports. Adapters never import packs (§3.3), so the composition root
	// injects the loader; a missing loader fails closed, never allows.
	readonly loadEnforcers?: HookEnforcerLoader;
}

// SPEC §4.19.3 step 5: pack enforcers for the hook evaluation, resolved by
// the composition root against the root-confined ports over the pack ids
// of the effective config. A resolution failure carries the loader's own
// code, so the hook blocks with it.
export type HookEnforcerLoader = (
	ports: Ports,
	packIds: ReadonlyArray<string>,
) => Promise<Result<ReadonlyArray<Enforcer>>>;

// SPEC §4.19.3: any uncaught error blocks CDX-E901; the time limit blocks
// CDX-E902. Both replies go through the adapter so the harness gates
// closed in its own deny form.
export async function runHookEvent(
	request: HookRunRequest,
): Promise<HookReply> {
	const adapter = adapterFor(request.harness);
	if (adapter === undefined) {
		return unknownHarnessReply(request.harness);
	}
	try {
		return await runHookInner(request, adapter);
	} catch {
		return blockReply(
			adapter,
			"CDX-E901",
			"the hook runtime failed before replying",
		);
	}
}

async function runHookInner(
	request: HookRunRequest,
	adapter: Adapter,
): Promise<HookReply> {
	if (
		new TextEncoder().encode(request.stdinText).length > HOOK_PAYLOAD_MAX_BYTES
	) {
		return blockReply(
			adapter,
			"CDX-E305",
			"hook payload over 8 MiB is refused; write the file in smaller edits",
		);
	}
	if (request.stdinText.trim() === "") {
		return blockReply(adapter, "CDX-E303", "hook stdin is empty");
	}
	const parsed = parseJson(request.stdinText);
	if (!parsed.ok) {
		return blockReply(adapter, "CDX-E303", "hook payload is not JSON");
	}
	const raw = parsed.value;
	const hookEvent = adapter.parse(request.event, raw);
	if (!hookEvent.ok) {
		return blockReply(adapter, hookEvent.error.code, hookEvent.error.message);
	}
	const event = hookEvent.value;
	const root = await resolveRoot(
		request.ports,
		event.cwd === "" ? request.cwd : event.cwd,
	);
	if (root === undefined) {
		return allowReply(adapter, "no-root");
	}
	if (stopHookActive(adapter, event, raw)) {
		return allowReply(adapter, "stop-active");
	}
	const effective = await loadEffective(request.ports, root, adapter);
	if (!effective.ok) {
		return effective.reply;
	}
	const fsMade = await NodeFs.create({ root });
	if (!fsMade.ok) {
		return blockReply(adapter, "CDX-E801", fsMade.error.message);
	}
	if (request.loadEnforcers === undefined) {
		return blockReply(
			adapter,
			"CDX-E901",
			"the hook cannot evaluate without enforcers",
		);
	}
	const ports: Ports = {
		fs: fsMade.value,
		proc: request.ports.proc,
		net: request.ports.net,
		clock: request.ports.clock,
		git: new NodeGit(request.ports.proc, root),
		env: hookEnv(request.ports.env),
	};
	const loaded = await request.loadEnforcers(
		ports,
		effective.value.config.packs.map((entry) => entry.id),
	);
	if (!loaded.ok) {
		return blockReply(
			adapter,
			errorCodeOf(loaded.error, "CDX-E203"),
			errorMessageOf(loaded.error),
		);
	}
	const engine = createEngine(loaded.value, {
		configHash: effective.value.configHash,
		append: (verdict) => request.append(root, verdict),
	});
	const scope = hookScope(event, root);
	// SPEC §4.6.3 + §4.18.3: the L0 triggers render the scoped injection
	// and land the auditable event before evaluation, so the status row
	// reads live evidence even when the verdict blocks. An unwritable log
	// blocks CDX-E801, like the verdict path.
	const injected = await emitInjectionEvent({
		event,
		scope,
		steering: effective.value.config.steering,
		configHash: effective.value.configHash,
		root,
		append: request.append,
	});
	if (!injected.ok) {
		return blockReply(adapter, injected.error.code, injected.error.message);
	}
	const budgetMs = hookBudgetMs(request.harness, request.budgetMs);
	const timeoutSignal = Symbol("hook-timeout");
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const pending = engine.evaluate(
			event.trigger,
			scope,
			request.ports.clock.now(),
		);
		const verdict = await Promise.race([
			pending,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => {
					reject(timeoutSignal);
				}, budgetMs);
			}),
		]);
		if (verdict.decision === "block" || verdict.decision === "escalate") {
			return adapter.reply({
				decision: "block",
				message: verdict.message,
				eventId: verdict.eventId,
			});
		}
		// Muse Code has no advise form: without steering injection (phase 9)
		// an advise collapses to allow. OpenCode carries it on the wire.
		if (
			verdict.decision === "advise" &&
			verdict.message !== "" &&
			adapter.id === "opencode"
		) {
			return adapter.reply({
				decision: "advise",
				message: verdict.message,
				eventId: verdict.eventId,
			});
		}
		return adapter.reply({ decision: "allow", eventId: verdict.eventId });
	} catch (error) {
		if (error === timeoutSignal) {
			return blockReply(
				adapter,
				"CDX-E902",
				"the hook exceeded its time limit",
			);
		}
		throw error;
	} finally {
		if (timer !== undefined) {
			clearTimeout(timer);
		}
	}
}

export function supportedHarness(harness: string): boolean {
	return adapterFor(harness) !== undefined;
}

// The pre-engine deny in the harness's own form (SPEC §4.5.1): staticBlock
// carries no engine state, so the launcher and the CLI start path use it
// when the engine cannot run (CDX-E002, CDX-E003).
export function staticBlock(
	harness: string,
	code: string,
	message: string,
): HookReply | undefined {
	const adapter = adapterFor(harness);
	if (adapter === undefined) {
		return undefined;
	}
	return adapter.staticBlock(code, message);
}
