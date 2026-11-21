// SPEC §4.6.5 + §7.8: the hook entry's side of the per-session read cache.
// It loads `.codictator/state/sessions/<sessionId>/reads.jsonl` as hook input
// (never an adapter), marks the read targets the cache already holds
// unchanged on the scope for `core/read-dedupe`, and appends one line per
// allowed read. Split from runtime.ts by responsibility (core/file-size).
import type { Ports, Scope } from "../../kernel/index.ts";
import { normalizeText, parseJson, sha256Text } from "../../kernel/index.ts";
import {
	createReadCache,
	isRepeatRead,
	type ReadRange,
	recordRead,
} from "../steering/index.ts";
import type { HookEvent } from "./contract.ts";

interface ReadLine {
	readonly path: string;
	readonly hash: string;
	readonly call: number;
	readonly range?: ReadRange;
}

// SPEC §4.6.5: no session id, no cache; only a read-kind call is cached
// (a search or a write is never a read of a file).
function cachedRead(event: HookEvent, scope: Scope): boolean {
	return (
		event.sessionId !== undefined &&
		event.tool?.kind === "read" &&
		scope.toolAccess === "read"
	);
}

function stateFile(sessionId: string): string {
	return `.codictator/state/sessions/${sessionId.replace(/[^A-Za-z0-9._-]/g, "_")}/reads.jsonl`;
}

function lineOf(text: string): ReadLine | undefined {
	const parsed = parseJson(text);
	if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) {
		return undefined;
	}
	const raw = parsed.value as Record<string, unknown>;
	const { path, hash, call, range } = raw;
	if (
		typeof path !== "string" ||
		typeof hash !== "string" ||
		typeof call !== "number"
	) {
		return undefined;
	}
	const span = range as Partial<ReadRange> | undefined;
	return typeof span?.offset === "number" && typeof span.limit === "number"
		? { path, hash, call, range: { offset: span.offset, limit: span.limit } }
		: { path, hash, call };
}

async function loadLines(
	ports: Ports,
	sessionId: string,
): Promise<Array<ReadLine>> {
	const seen = await ports.fs.exists(stateFile(sessionId));
	const text =
		seen.ok && seen.value
			? await ports.fs.readText(stateFile(sessionId))
			: undefined;
	if (text === undefined || !text.ok) {
		return [];
	}
	const lines: Array<ReadLine> = [];
	for (const row of text.value.split("\n")) {
		const line = row.trim() === "" ? undefined : lineOf(row);
		if (line !== undefined) {
			lines.push(line);
		}
	}
	return lines;
}

// A target that cannot be read as text (absent, binary, outside the root) is
// never cached, so it is never a repeat.
async function hashOf(ports: Ports, path: string): Promise<string | undefined> {
	const text = await ports.fs.readText(path);
	return text.ok ? sha256Text(normalizeText(text.value)) : undefined;
}

// SPEC §4.6.5: the targets whose same range this session already read and
// whose content is unchanged (EC-9 lets a modified file through), each with
// the call number of the read that put it in context.
export async function repeatReadsFor(
	ports: Ports,
	event: HookEvent,
	scope: Scope,
): Promise<NonNullable<Scope["repeatReads"]>> {
	const sessionId = event.sessionId;
	if (sessionId === undefined || !cachedRead(event, scope)) {
		return [];
	}
	const cache = createReadCache();
	const firstCall = new Map<string, number>();
	for (const line of await loadLines(ports, sessionId)) {
		if (cache.get(line.path)?.hash !== line.hash) {
			firstCall.set(line.path, line.call);
		}
		recordRead(cache, line.path, line.hash, line.range);
	}
	const repeats: Array<{ path: string; call: number }> = [];
	for (const path of scope.proposedPaths ?? []) {
		const hash = await hashOf(ports, path);
		if (
			hash !== undefined &&
			isRepeatRead(cache, path, hash, event.tool?.range)
		) {
			repeats.push({ path, call: firstCall.get(path) ?? 0 });
		}
	}
	return repeats;
}

// SPEC §4.6.5: one appended line per allowed read (one O_APPEND per line, so
// concurrent hooks never interleave). A failed append is not a block: the
// worst case is one repeat read that passes.
export async function recordAllowedReads(
	ports: Ports,
	event: HookEvent,
	scope: Scope,
): Promise<void> {
	const sessionId = event.sessionId;
	if (sessionId === undefined || !cachedRead(event, scope)) {
		return;
	}
	let call = (await loadLines(ports, sessionId)).length;
	for (const path of scope.proposedPaths ?? []) {
		const hash = await hashOf(ports, path);
		if (hash === undefined) {
			continue;
		}
		call += 1;
		const range = event.tool?.range;
		const row = JSON.stringify({
			path,
			hash,
			call,
			...(range === undefined ? {} : { range }),
		});
		await ports.fs.append(
			stateFile(sessionId),
			new TextEncoder().encode(`${row}\n`),
		);
	}
}

// The scope the engine judges: the hook scope plus the repeat targets, left
// untouched when there are none.
export async function scopeWithReads(
	ports: Ports,
	event: HookEvent,
	scope: Scope,
): Promise<Scope> {
	const repeats = await repeatReadsFor(ports, event, scope);
	return repeats.length === 0 ? scope : { ...scope, repeatReads: repeats };
}
