// SPEC §4.6.3 + §4.18.1: the live scoped-injection evidence. The hook
// runtime renders the injection on session start, after compaction and on
// prompt submit, and lands the auditable event through the existing append
// port, so the status row reads live evidence instead of missing. Split
// from runtime.ts by responsibility (CONVENTIONS size); the trigger gate,
// usage threading and append stay here so runHookInner keeps its step
// order. Adapters never import audit (§3.3), so the event travels as a
// structural literal matching buildInjectionEvent, which audit owns; the
// contract test pins them equal. Usage threads through only when present
// and sane, else the band stays unavailable, never estimated (EC-4).
import type { Result, Scope } from "../../kernel/index.ts";
import { ok } from "../../kernel/index.ts";
import {
	renderScopedInjection,
	SCOPED_INJECTION_MAX_BYTES,
} from "../steering/index.ts";
import type { HookEvent } from "./contract.ts";
import type { HookAppend } from "./runtime.ts";

export interface InjectionEmission {
	readonly event: HookEvent;
	readonly scope: Scope;
	readonly steering: unknown;
	readonly configHash: string;
	readonly root: string;
	readonly append: HookAppend;
}

// SPEC §4.6.3: the injection renders on session start, after compaction
// and on prompt submit, all L0 triggers. Tool triggers carry no injection.
function isInjectionTrigger(
	trigger: HookEvent["trigger"],
): trigger is "startup" | "compact" | "prompt" {
	return trigger === "startup" || trigger === "compact" || trigger === "prompt";
}

// SPEC §4.6.7 EC-4: used tokens count only when present and sane; a
// missing or negative count leaves the band unavailable, never estimated.
function usedTokensOf(usage: HookEvent["usage"]): number | undefined {
	const seen = usage?.contextTokens;
	if (seen === undefined || !Number.isFinite(seen) || seen < 0) {
		return undefined;
	}
	return seen;
}

// SPEC §4.6.7 EC-4: the window is the live usage window, else the
// configured steering window; an absent or non-positive window leaves the
// band unavailable, never estimated.
function hasWindow(
	value: unknown,
): value is { readonly contextWindow?: unknown } {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contextWindowOf(
	usage: HookEvent["usage"],
	steering: unknown,
): number | undefined {
	const seen = usage?.contextWindow;
	if (seen !== undefined && Number.isFinite(seen) && seen > 0) {
		return seen;
	}
	if (hasWindow(steering)) {
		const configured: unknown = steering.contextWindow;
		if (
			typeof configured === "number" &&
			Number.isFinite(configured) &&
			configured > 0
		) {
			return configured;
		}
	}
	return undefined;
}

// SPEC §4.6.3: the injection scope is the lexical hook scope, so the
// render names the same targets the verdict judges. L0 triggers carry no
// tool, so the scope is empty and the render takes the no-task branch;
// the budget line still carries the band.
function injectionScope(scope: Scope): ReadonlyArray<string> {
	return [...scope.files, ...(scope.proposedPaths ?? [])];
}

// SPEC §4.18.1 + §4.6.3: render the scoped injection for an L0 trigger
// and append the auditable event. Non-injection triggers append nothing.
// An append failure returns the audit error so the runtime blocks closed.
export async function emitInjectionEvent(
	input: InjectionEmission,
): Promise<Result<boolean>> {
	const trigger = input.event.trigger;
	if (!isInjectionTrigger(trigger)) {
		return ok(false);
	}
	const usedTokens = usedTokensOf(input.event.usage);
	const contextWindow = contextWindowOf(input.event.usage, input.steering);
	const rendered = await renderScopedInjection(
		input.event.sessionId,
		injectionScope(input.scope),
		SCOPED_INJECTION_MAX_BYTES,
		{
			...(usedTokens === undefined ? {} : { usedTokens }),
			...(contextWindow === undefined ? {} : { contextWindow }),
		},
	);
	const appended = await input.append(input.root, {
		kind: "injection",
		layer: "L0",
		trigger,
		harness: input.event.harness,
		sessionId: input.event.sessionId,
		ruleIds: [],
		durationMs: 0,
		configHash: input.configHash,
		packs: {},
		message: rendered.content,
	});
	if (!appended.ok) {
		return appended;
	}
	return ok(true);
}
