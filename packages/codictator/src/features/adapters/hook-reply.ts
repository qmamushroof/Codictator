// SPEC §4.6.3: the L0 reply shaping. The hook runtime renders the scoped
// injection for session start, compaction and prompt submit and returns it
// as additionalContext, shaped per harness by the adapter contract. Split
// from runtime.ts by responsibility (core/file-size); the run composition
// and step order stay there.
import type { Ports, Result, Scope } from "../../kernel/index.ts";
import type { Verdict } from "../engine/index.ts";
import { injectionDigest } from "../steering/index.ts";
import type {
	Adapter,
	HookDecision,
	HookEvent,
	HookReply,
} from "./contract.ts";
import {
	isInjectionTrigger,
	lastInjectionDigest,
	renderInjectionContent,
} from "./hook-injection.ts";

export interface InjectionReplyInput {
	readonly event: HookEvent;
	readonly scope: Scope;
	readonly steering: unknown;
	readonly ports: Ports;
	readonly root: string;
}

// SPEC §4.6.3: the additionalContext for an L0 reply, or undefined when
// the trigger carries no injection (non-L0) or the prompt hash matches the
// last injection in the session. A render failure returns the audit error
// so the runtime blocks closed.
export async function injectionForReply(
	input: InjectionReplyInput,
): Promise<Result<string | undefined>> {
	if (!isInjectionTrigger(input.event.trigger)) {
		return { ok: true as const, value: undefined };
	}
	const rendered = await renderInjectionContent({
		event: input.event,
		scope: input.scope,
		steering: input.steering,
		ports: input.ports,
		root: input.root,
	});
	if (!rendered.ok) {
		return rendered;
	}
	if (input.event.trigger === "prompt") {
		const prior = await lastInjectionDigest(
			input.ports.fs,
			input.event.sessionId,
		);
		return {
			ok: true as const,
			value:
				prior === injectionDigest(rendered.value) ? undefined : rendered.value,
		};
	}
	return { ok: true as const, value: rendered.value };
}

// SPEC §4.6.3: the L0 injection rides the verdict reply as
// additionalContext; non-L0 triggers leave the decision untouched.
export function withInjection(
	decision: HookDecision,
	additionalContext: string | undefined,
): HookDecision {
	return additionalContext === undefined
		? decision
		: { ...decision, additionalContext };
}

// The verdict reply with the L0 injection attached. Block and escalate
// share the deny form; advise rides only on OpenCode, collapsing to allow
// elsewhere.
export function replyForVerdict(
	adapter: Adapter,
	verdict: Verdict,
	additionalContext: string | undefined,
): HookReply {
	if (verdict.decision === "block" || verdict.decision === "escalate") {
		return adapter.reply(
			withInjection(
				{
					decision: "block",
					message: verdict.message,
					eventId: verdict.eventId,
				},
				additionalContext,
			),
		);
	}
	if (
		verdict.decision === "advise" &&
		verdict.message !== "" &&
		adapter.id === "opencode"
	) {
		return adapter.reply(
			withInjection(
				{
					decision: "advise",
					message: verdict.message,
					eventId: verdict.eventId,
				},
				additionalContext,
			),
		);
	}
	return adapter.reply(
		withInjection(
			{ decision: "allow", eventId: verdict.eventId },
			additionalContext,
		),
	);
}
