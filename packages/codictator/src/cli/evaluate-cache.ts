// SPEC §4.3.6: the shared scope-read cache, split from cli/evaluate.ts by
// responsibility (CONVENTIONS size). One verify evaluation reads each
// scope file once: the cache memo shares in-flight and completed reads
// across enforcers, and writes, appends and removals invalidate the path.
// Results are copies, so a guard can never mutate another guard's bytes.
import type { Fs, Result } from "../kernel/index.ts";

function sharedRead(
	inner: Fs,
	reads: Map<string, Promise<Result<Uint8Array>>>,
): Fs["read"] {
	return (path: string): Promise<Result<Uint8Array>> => {
		const hit = reads.get(path);
		if (hit !== undefined) {
			return hit.then((result) =>
				result.ok ? { ok: true as const, value: result.value.slice() } : result,
			);
		}
		const pending = inner.read(path);
		reads.set(path, pending);
		return pending.then((result) =>
			result.ok ? { ok: true as const, value: result.value.slice() } : result,
		);
	};
}

function sharedReadText(
	inner: Fs,
	texts: Map<string, Promise<Result<string>>>,
): Fs["readText"] {
	return (path: string): Promise<Result<string>> => {
		const hit = texts.get(path);
		if (hit !== undefined) {
			return hit;
		}
		const pending = inner.readText(path);
		texts.set(path, pending);
		return pending;
	};
}

function sharedRealpath(
	inner: Fs,
	reals: Map<string, Promise<Result<string>>>,
): Fs["realpath"] {
	return (path: string): Promise<Result<string>> => {
		const hit = reals.get(path);
		if (hit !== undefined) {
			return hit;
		}
		const pending = inner.realpath(path);
		reals.set(path, pending);
		return pending;
	};
}

export function sharedReads(inner: Fs): Fs {
	const reads = new Map<string, Promise<Result<Uint8Array>>>();
	const texts = new Map<string, Promise<Result<string>>>();
	const reals = new Map<string, Promise<Result<string>>>();
	const drop = (path: string): void => {
		reads.delete(path);
		texts.delete(path);
		reals.delete(path);
	};
	const invalidate = <T>(
		done: Promise<Result<T>>,
		path: string,
	): Promise<Result<T>> =>
		done.then((result) => {
			if (result.ok) {
				drop(path);
			}
			return result;
		});
	return {
		read: sharedRead(inner, reads),
		readText: sharedReadText(inner, texts),
		write: (path: string, content: Uint8Array): Promise<Result<void>> =>
			invalidate(inner.write(path, content), path),
		append: (path: string, content: Uint8Array): Promise<Result<void>> =>
			invalidate(inner.append(path, content), path),
		remove: (path: string): Promise<Result<void>> =>
			invalidate(inner.remove(path), path),
		stat: (path: string) => inner.stat(path),
		list: (dir: string) => inner.list(dir),
		glob: (pattern: string, dir: string) => inner.glob(pattern, dir),
		exists: (path: string) => inner.exists(path),
		realpath: sharedRealpath(inner, reals),
	};
}
