// SPEC §4.19.3 steps 1-6: the hook runtime. It lives in adapters (not cli/)
// because hook I/O translation is the adapter module's job (§3.3 table:
// adapters may import kernel, config, engine, steering); cli/ composes it
// with the audit append and the process sinks. Only the reply-capable
// harnesses dispatch here; universal parses fail-closed (no hook traffic)
// and every other unknown id stays CDX-E301. The loop breaker (§4.12.5)
// runs at step 5 once its phase lands; until then the verdict decides.
// The steering injection (§4.6.3) renders at step 5 for L0 triggers and
// rides the reply as additionalContext. Split with hook-dispatch.ts (routing),
// hook-static.ts (pre-engine deny), hook-load.ts (root and config) and
// hook-scope.ts (L1 scope); this file keeps the public contract and the
// run composition.
import type {
	Clock,
	Env,
	Net,
	Ports,
	Proc,
	Result,
} from "../../kernel/index.ts";
import { NodeFs, NodeGit, parseJson } from "../../kernel/index.ts";
import { ENGINE_VERSION } from "../config/index.ts";
import type { Enforcer, EngineOptions, WaiverStore } from "../engine/index.ts";
import { createEngine, packsRecord } from "../engine/index.ts";
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
	resolveRoots,
} from "./hook-load.ts";
import { injectionForReply, replyForVerdict } from "./hook-reply.ts";
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
	// Resolved installed engine version (§4.2.1). The CLI entry sets it from
	// the engine manifest; unset stays the pinned placeholder so tests
	// evaluate without I/O.
	readonly engineVersion?: string;
	// SPEC §4.19.3: the real pack enforcers, resolved against root-confined
	// ports. Adapters never import packs (§3.3), so the composition root
	// injects the loader; a missing loader fails closed, never allows.
	readonly loadEnforcers?: HookEnforcerLoader;
}

// SPEC §4.19.3 step 5: pack enforcers plus the file waiver store for the
// hook evaluation, resolved by the composition root against the
// root-confined ports over the pack ids of the effective config. A
// resolution failure carries the loader's own code, so the hook blocks
// with it.
export type HookEnforcerLoader = (
	ports: Ports,
	packIds: ReadonlyArray<string>,
) => Promise<
	Result<{
		readonly enforcers: ReadonlyArray<Enforcer>;
		readonly waiverStore: WaiverStore;
	}>
>;

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
	const roots = await resolveRoots(
		request.ports,
		event.cwd === "" ? request.cwd : event.cwd,
	);
	if (roots === undefined) {
		return allowReply(adapter, "no-root");
	}
	const root = roots.canonical;
	if (stopHookActive(adapter, event, raw)) {
		return allowReply(adapter, "stop-active");
	}
	const effective = await loadEffective(
		request.ports,
		root,
		adapter,
		request.engineVersion ?? ENGINE_VERSION,
	);
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
	// SPEC §7.10 + §4.18: the verdict pins the evaluated pack versions and
	// its harness source, so the Timeline row names what judged the call.
	const packs = packsRecord(
		effective.value.config.packs,
		request.engineVersion ?? ENGINE_VERSION,
	);
	const engine = createEngine(loaded.value.enforcers, {
		configHash: effective.value.configHash,
		packs,
		waiverStore: loaded.value.waiverStore,
		append: (verdict) =>
			request.append(root, {
				...verdict,
				harness: event.harness,
				packs,
				...(event.sessionId === undefined
					? {}
					: { sessionId: event.sessionId }),
			}),
	});
	const scope = hookScope(
		event,
		root,
		roots.raw,
		event.cwd === "" ? request.cwd : event.cwd,
	);
	// SPEC §4.6.3 + §4.18.3: the L0 triggers render the scoped injection
	// and land the auditable event before evaluation, so the status row
	// reads live evidence even when the verdict blocks. An unwritable log
	// blocks CDX-E801, like the verdict path. The reply digest compares
	// against the pre-append log: the reply renders first, then the event
	// appends, so prompt.submit sees the prior injection and not its own.
	const injectedReply = await injectionForReply({
		event,
		scope,
		steering: effective.value.config.steering,
		ports,
		root,
	});
	if (!injectedReply.ok) {
		return blockReply(
			adapter,
			injectedReply.error.code,
			injectedReply.error.message,
		);
	}
	const injected = await emitInjectionEvent({
		event,
		scope,
		steering: effective.value.config.steering,
		configHash: effective.value.configHash,
		root,
		append: request.append,
		ports,
	});
	if (!injected.ok) {
		return blockReply(adapter, injected.error.code, injected.error.message);
	}
	// SPEC §4.6.3: L0 triggers return the rendered injection as
	// additionalContext, shaped per harness by the adapter contract
	// (Claude hookSpecificOutput, OpenCode wire field). Prompt.submit
	// resends only when its hash differs from the last injection in the
	// session, so an unchanged state costs nothing.
	const additionalContext = injectedReply.value;
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
		return replyForVerdict(adapter, verdict, additionalContext);
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

// The pre-engine deny lives in hook-static.ts; re-exported here so the
// barrel and the launcher keep one import.
export { staticBlock, supportedHarness } from "./hook-static.ts";
