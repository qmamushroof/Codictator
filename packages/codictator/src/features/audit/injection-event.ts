// SPEC §4.18.1 + §4.6.3: the auditable scoped-injection event. The hook
// runtime renders the injection (§4.6.3) and lands this event through the
// existing append path, so the status row reads live evidence (§4.18.3)
// instead of synthetic markers. The message carries the rendered content
// (already agent-facing, never file content or tool output); the id digest
// derives from it at append time, and the byte count is its length.
import type { NewEvent } from "./append.ts";

export interface InjectionEventInput {
	readonly content: string;
	// SPEC §4.6.3: injection renders on session start, after compaction
	// and on prompt submit, all L0 triggers.
	readonly trigger: "startup" | "compact" | "prompt";
	readonly sessionId?: string;
	readonly taskId?: string;
	readonly harness?: string;
	readonly configHash: string;
	readonly packs?: Readonly<Record<string, string>>;
}

// SPEC §4.3.3 evaluation pattern (evaluate.ts:322): one NewEvent literal
// per emission; the log owns the id, timestamp and line shape (§7.10).
export function buildInjectionEvent(input: InjectionEventInput): NewEvent {
	return {
		kind: "injection",
		layer: "L0",
		trigger: input.trigger,
		...(input.harness === undefined ? {} : { harness: input.harness }),
		...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
		...(input.taskId === undefined ? {} : { taskId: input.taskId }),
		ruleIds: [],
		durationMs: 0,
		configHash: input.configHash,
		packs: input.packs ?? {},
		message: input.content,
	};
}
