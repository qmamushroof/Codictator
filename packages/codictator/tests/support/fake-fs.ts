// SPEC §10.2: an in-memory Fs port for unit tests (SPEC §4.1.1). Keys are
// literal paths after separator normalisation; path confinement (SPEC §4.1.3
// EC-1) is kernel behaviour proved against the real kernel later, not here.
// Unseeded reads are programmer errors and reject; kernel failures are
// simulated with failNext carrying a real SPEC §8 error from the caller.
import type { CdxError, Fs, FsStat, Result } from "../../src/kernel/index.ts";

function normalizeKey(path: string): string {
	const slashes = path.split("\\").join("/");
	const collapsed = slashes.replace(/\/{2,}/g, "/");
	const trimmed =
		collapsed.endsWith("/") && collapsed.length > 1
			? collapsed.slice(0, -1)
			: collapsed;
	return trimmed.startsWith("./") ? trimmed.slice(2) : trimmed;
}

function splitSegments(key: string): Array<string> {
	return key.split("/").filter((segment) => segment.length > 0);
}

const REGEXP_SPECIALS = ".*+?^{}()|[]\\$";

function escapeSegmentChar(char: string): string {
	if (REGEXP_SPECIALS.includes(char)) {
		return ["\\", char].join("");
	}
	return char;
}

function segmentPattern(segment: string): RegExp {
	let out = "";
	for (const char of segment) {
		if (char === "*") {
			out += "[^/]*";
		} else if (char === "?") {
			out += "[^/]";
		} else {
			out += escapeSegmentChar(char);
		}
	}
	return new RegExp(`^${out}$`);
}

function matchSegments(
	pattern: ReadonlyArray<string>,
	target: ReadonlyArray<string>,
): boolean {
	if (pattern.length === 0) {
		return target.length === 0;
	}
	const head = pattern[0];
	if (head === "**") {
		for (let skip = 0; skip <= target.length; skip += 1) {
			if (matchSegments(pattern.slice(1), target.slice(skip))) {
				return true;
			}
		}
		return false;
	}
	if (head === undefined || target.length === 0) {
		return false;
	}
	const first = target[0];
	if (first === undefined || !segmentPattern(head).test(first)) {
		return false;
	}
	return matchSegments(pattern.slice(1), target.slice(1));
}

export class FakeFs implements Fs {
	private readonly files = new Map<string, Uint8Array>();
	private pending: CdxError | undefined;

	failNext(error: CdxError): void {
		this.pending = error;
	}

	private nextFailure(): Result<never> | undefined {
		const failure = this.pending;
		this.pending = undefined;
		return failure === undefined ? undefined : { ok: false, error: failure };
	}

	private missing(path: string): Promise<never> {
		return Promise.reject(
			new Error(`fake fs has no file at ${path}; seed it or arm failNext`),
		);
	}

	read(path: string): Promise<Result<Uint8Array>> {
		const failure = this.nextFailure();
		if (failure !== undefined) {
			return Promise.resolve(failure);
		}
		const found = this.files.get(normalizeKey(path));
		if (found === undefined) {
			return this.missing(path);
		}
		return Promise.resolve<Result<Uint8Array>>({
			ok: true,
			value: found.slice(),
		});
	}

	readText(path: string): Promise<Result<string>> {
		const failure = this.nextFailure();
		if (failure !== undefined) {
			return Promise.resolve(failure);
		}
		const found = this.files.get(normalizeKey(path));
		if (found === undefined) {
			return this.missing(path);
		}
		return Promise.resolve<Result<string>>({
			ok: true,
			value: new TextDecoder().decode(found),
		});
	}

	write(path: string, content: Uint8Array): Promise<Result<void>> {
		const failure = this.nextFailure();
		if (failure !== undefined) {
			return Promise.resolve(failure);
		}
		this.files.set(normalizeKey(path), content.slice());
		return Promise.resolve<Result<void>>({ ok: true, value: undefined });
	}

	append(path: string, content: Uint8Array): Promise<Result<void>> {
		const failure = this.nextFailure();
		if (failure !== undefined) {
			return Promise.resolve(failure);
		}
		const key = normalizeKey(path);
		const existing = this.files.get(key) ?? new Uint8Array(0);
		const joined = new Uint8Array(existing.length + content.length);
		joined.set(existing, 0);
		joined.set(content, existing.length);
		this.files.set(key, joined);
		return Promise.resolve<Result<void>>({ ok: true, value: undefined });
	}

	stat(path: string): Promise<Result<FsStat>> {
		const failure = this.nextFailure();
		if (failure !== undefined) {
			return Promise.resolve(failure);
		}
		const key = normalizeKey(path);
		const found = this.files.get(key);
		if (found !== undefined) {
			return Promise.resolve<Result<FsStat>>({
				ok: true,
				value: { isFile: true, isDirectory: false, size: found.length },
			});
		}
		const prefix = key === "" ? "" : `${key}/`;
		for (const stored of this.files.keys()) {
			if (prefix !== "" && stored.startsWith(prefix)) {
				return Promise.resolve<Result<FsStat>>({
					ok: true,
					value: { isFile: false, isDirectory: true, size: 0 },
				});
			}
		}
		if (prefix === "" && this.files.size > 0) {
			return Promise.resolve<Result<FsStat>>({
				ok: true,
				value: { isFile: false, isDirectory: true, size: 0 },
			});
		}
		return this.missing(path);
	}

	list(dir: string): Promise<Result<Array<string>>> {
		const failure = this.nextFailure();
		if (failure !== undefined) {
			return Promise.resolve(failure);
		}
		const key = normalizeKey(dir);
		if (this.files.has(key)) {
			return Promise.reject(
				new Error(`fake fs cannot list file ${dir}; it is not a directory`),
			);
		}
		const prefix = key === "" ? "" : `${key}/`;
		const names = new Set<string>();
		for (const stored of this.files.keys()) {
			if (!stored.startsWith(prefix)) {
				continue;
			}
			const rest = splitSegments(stored.slice(prefix.length));
			const first = rest[0];
			if (first !== undefined) {
				names.add(first);
			}
		}
		return Promise.resolve<Result<Array<string>>>({
			ok: true,
			value: [...names].sort(),
		});
	}

	glob(pattern: string, dir: string): Promise<Result<Array<string>>> {
		const failure = this.nextFailure();
		if (failure !== undefined) {
			return Promise.resolve(failure);
		}
		const key = normalizeKey(dir);
		const prefix = key === "" ? "" : `${key}/`;
		const wanted = splitSegments(pattern);
		const matched: Array<string> = [];
		for (const stored of this.files.keys()) {
			if (!stored.startsWith(prefix)) {
				continue;
			}
			const relative = splitSegments(stored.slice(prefix.length));
			if (matchSegments(wanted, relative)) {
				matched.push(stored);
			}
		}
		matched.sort();
		return Promise.resolve<Result<Array<string>>>({ ok: true, value: matched });
	}

	exists(path: string): Promise<Result<boolean>> {
		const failure = this.nextFailure();
		if (failure !== undefined) {
			return Promise.resolve(failure);
		}
		return Promise.resolve<Result<boolean>>({
			ok: true,
			value: this.files.has(normalizeKey(path)),
		});
	}

	realpath(path: string): Promise<Result<string>> {
		const failure = this.nextFailure();
		if (failure !== undefined) {
			return Promise.resolve(failure);
		}
		return Promise.resolve<Result<string>>({
			ok: true,
			value: normalizeKey(path),
		});
	}

	remove(path: string): Promise<Result<void>> {
		const failure = this.nextFailure();
		if (failure !== undefined) {
			return Promise.resolve(failure);
		}
		const key = normalizeKey(path);
		this.files.delete(key);
		const prefix = key === "" ? "" : `${key}/`;
		for (const stored of [...this.files.keys()]) {
			if (stored.startsWith(prefix)) {
				this.files.delete(stored);
			}
		}
		return Promise.resolve<Result<void>>({ ok: true, value: undefined });
	}

	seedText(path: string, text: string): void {
		this.files.set(normalizeKey(path), new TextEncoder().encode(text));
	}

	seedBytes(path: string, content: Uint8Array): void {
		this.files.set(normalizeKey(path), content.slice());
	}

	clear(): void {
		this.files.clear();
		this.pending = undefined;
	}
}
