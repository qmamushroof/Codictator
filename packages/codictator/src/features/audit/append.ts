// SPEC §4.18.1: event log append. One fs.append call per event, so
// concurrent hook processes never interleave lines; lines stay under 64 KB
// (the message is truncated with a marker first); past 5 MiB the log
// rotates to events.<n>.jsonl keeping the newest five.

import type {
	CdxError,
	Decision,
	Finding,
	Ports,
	Trigger,
} from "../../kernel/index.ts";
import {
	err,
	makeError,
	ok,
	type Result,
	redactSecrets,
	sha256Text,
	stableLineStringify,
	stableStringify,
} from "../../kernel/index.ts";
import type { EventFinding, EventKind } from "./index.ts";

export const LOG_REL = ".codictator/state/events.jsonl";
export const MAX_LINE_BYTES = 64 * 1024;
export const MAX_LOG_BYTES = 5 * 1024 * 1024;
export const KEEP_ROTATED = 5;

// §7.10 minus the fields the log owns (v, id, ts, now).
export interface NewEvent {
	readonly kind: EventKind;
	readonly layer: string;
	readonly trigger: Trigger;
	readonly harness?: string;
	readonly sessionId?: string;
	readonly taskId?: string;
	readonly ruleIds: ReadonlyArray<string>;
	readonly decision?: Decision;
	readonly findings?: ReadonlyArray<Finding>;
	// SPEC §4.3.4: ids of the waivers that changed a verdict.
	readonly waivers?: ReadonlyArray<string>;
	// SPEC §4.3.9 EC-15: set when now predates the previous event.
	readonly clockSkew?: boolean;
	readonly durationMs: number;
	readonly configHash: string;
	readonly packs: Readonly<Record<string, string>>;
	readonly message?: string;
	readonly ts?: string;
}

function byteLength(text: string): number {
	return new TextEncoder().encode(text).length;
}

function e801(action: string, detail: string): CdxError {
	return makeError(
		"CDX-E801",
		`event log not writable: cannot ${action}`,
		"Free disk space and fix permissions on .codictator/state/, then retry.",
		detail,
	);
}

// SPEC §7.10: sortable id from now plus a content digest. The per-process
// counter arrives with the engine sequence; without it the digest keeps E1
// ids unique without module-level mutable state.
function makeEventId(now: string, canonical: string, seq?: number): string {
	const stamp = now.replace(/[-:.]/g, "");
	const digest = sha256Text(canonical).slice(0, 12);
	if (seq === undefined) {
		return `${stamp}-${digest}`;
	}
	return `${stamp}-${seq.toString().padStart(6, "0")}-${digest}`;
}

// SPEC §7.10: findings on the line carry rule, path, line and code only.
function projectFinding(finding: Finding): EventFinding {
	return {
		ruleId: finding.ruleId,
		...(finding.path === undefined ? {} : { path: finding.path }),
		...(finding.line === undefined ? {} : { line: finding.line }),
		...(finding.code === undefined ? {} : { code: finding.code }),
	};
}

function truncateUtf8(text: string, maxBytes: number): string {
	const bytes = new TextEncoder().encode(text);
	if (bytes.length <= maxBytes) {
		return text;
	}
	let cut = maxBytes;
	while (cut > 0) {
		const byte = bytes[cut];
		if (byte === undefined || (byte & 0xc0) !== 0x80) {
			break;
		}
		cut -= 1;
	}
	return new TextDecoder().decode(bytes.subarray(0, cut));
}

function withOptionals(
	base: Record<string, unknown>,
	event: NewEvent,
	message: string | undefined,
): Record<string, unknown> {
	return {
		...base,
		...(event.harness === undefined ? {} : { harness: event.harness }),
		...(event.sessionId === undefined ? {} : { sessionId: event.sessionId }),
		...(event.taskId === undefined ? {} : { taskId: event.taskId }),
		...(event.decision === undefined ? {} : { decision: event.decision }),
		...(event.waivers === undefined ? {} : { waivers: event.waivers }),
		...(event.clockSkew === undefined ? {} : { clockSkew: event.clockSkew }),
		...(event.findings === undefined
			? {}
			: { findings: event.findings.map(projectFinding) }),
		...(message === undefined ? {} : { message }),
	};
}

// SPEC §4.18.6 EC-2: the message is truncated with a marker before append.
function fitLine(event: NewEvent, now: string, id: string): Result<string> {
	const base: Record<string, unknown> = {
		v: 1,
		id,
		ts: event.ts ?? now,
		now,
		kind: event.kind,
		layer: event.layer,
		trigger: event.trigger,
		ruleIds: event.ruleIds,
		durationMs: event.durationMs,
		configHash: event.configHash,
		packs: event.packs,
	};
	const message =
		event.message === undefined ? undefined : redactSecrets(event.message);
	const full = stableLineStringify(withOptionals(base, event, message));
	if (byteLength(full) <= MAX_LINE_BYTES) {
		return ok(full);
	}
	if (message === undefined) {
		return err(
			e801("append event", "a single event without a message exceeds 64 KB"),
		);
	}
	const empty = stableLineStringify(withOptionals(base, event, ""));
	let allowance = MAX_LINE_BYTES - byteLength(empty) - 2;
	for (let round = 0; round < 32; round += 1) {
		if (allowance < 0) {
			return err(
				e801("append event", "the message cannot be truncated to fit 64 KB"),
			);
		}
		const kept = truncateUtf8(message, allowance);
		const omitted = byteLength(message) - byteLength(kept);
		const candidate = stableLineStringify(
			withOptionals(base, event, `${kept}[truncated ${omitted} bytes]`),
		);
		if (byteLength(candidate) <= MAX_LINE_BYTES) {
			return ok(candidate);
		}
		allowance = Math.floor(allowance / 2);
	}
	return err(
		e801("append event", "the message cannot be truncated to fit 64 KB"),
	);
}

function rotatedNumber(name: string): number | undefined {
	const match = /^events\.(\d+)\.jsonl$/.exec(name);
	if (match === null) {
		return undefined;
	}
	const raw = match[1];
	if (raw === undefined) {
		return undefined;
	}
	const parsed = Number.parseInt(raw, 10);
	return Number.isSafeInteger(parsed) ? parsed : undefined;
}

async function rotateLog(
	ports: Ports,
	root: string,
	logRel: string,
): Promise<CdxError | undefined> {
	const stateRel = `${root}/.codictator/state`;
	const listed = await ports.fs.list(stateRel);
	if (!listed.ok) {
		return e801("rotate the event log", listed.error.message);
	}
	let next = 1;
	const numbered: Array<number> = [];
	for (const name of listed.value) {
		const at = rotatedNumber(name);
		if (at !== undefined) {
			numbered.push(at);
			next = Math.max(next, at + 1);
		}
	}
	const current = await ports.fs.read(logRel);
	if (!current.ok) {
		return e801("rotate the event log", current.error.message);
	}
	const written = await ports.fs.write(
		`${stateRel}/events.${next}.jsonl`,
		current.value,
	);
	if (!written.ok) {
		return e801("rotate the event log", written.error.message);
	}
	const removed = await ports.fs.remove(logRel);
	if (!removed.ok) {
		return e801("rotate the event log", removed.error.message);
	}
	numbered.push(next);
	numbered.sort((a, b) => a - b);
	while (numbered.length > KEEP_ROTATED) {
		const oldest = numbered.shift();
		if (oldest === undefined) {
			break;
		}
		const deleted = await ports.fs.remove(`${stateRel}/events.${oldest}.jsonl`);
		if (!deleted.ok) {
			return e801("rotate the event log", deleted.error.message);
		}
	}
	return undefined;
}

// SPEC §4.18.1: append one line-atomic event; writes recreate the log when it
// was deleted mid-session; the log rotates past the size cap. The optional
// sequence carries the engine's per-process counter into the event id so a
// verdict's eventId matches its log line (SPEC §7.10).
export async function appendEvent(
	ports: Ports,
	repoRoot: string,
	event: NewEvent,
	seq?: number,
): Promise<Result<void>> {
	const stripped = repoRoot.replace(/\/+$/, "");
	const root = stripped === "" ? "." : stripped;
	const logRel = `${root}/${LOG_REL}`;
	const now = ports.clock.now();
	const canonical = stableStringify({
		kind: event.kind,
		layer: event.layer,
		trigger: event.trigger,
		ruleIds: [...event.ruleIds].sort(),
		durationMs: event.durationMs,
		configHash: event.configHash,
		packs: event.packs,
		message: event.message,
	});
	const fitted = fitLine(event, now, makeEventId(now, canonical, seq));
	if (!fitted.ok) {
		return err(fitted.error);
	}
	const lineBytes = new TextEncoder().encode(fitted.value);
	// exists() is the portable absence check: stat on a missing path
	// rejects on some ports, so it runs only when the log is there.
	const seen = await ports.fs.exists(logRel);
	if (!seen.ok) {
		return err(e801("append event", seen.error.message));
	}
	if (seen.value) {
		const stat = await ports.fs.stat(logRel);
		if (!stat.ok) {
			return err(e801("append event", stat.error.message));
		}
		if (stat.value.size + lineBytes.length > MAX_LOG_BYTES) {
			const rotated = await rotateLog(ports, root, logRel);
			if (rotated !== undefined) {
				return err(rotated);
			}
		}
	}
	const appended = await ports.fs.append(logRel, lineBytes);
	if (!appended.ok) {
		return err(e801("append event", appended.error.message));
	}
	return ok(undefined);
}
