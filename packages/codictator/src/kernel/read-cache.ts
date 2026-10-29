// SPEC §4.3.6 + §9.3: per-evaluation lossy-text cache behind the Fs
// port. One verify evaluation reads each scope file once; every guard
// after the first shares the bytes and the decode instead of paying a
// copy plus a TextDecoder pass per guard, which is what pushed
// full-tree evaluations past every guard budget (CDX-E902). The cache
// key is the Fs object itself, so each evaluation (each ports wrapper)
// gets a fresh map and nothing leaks across runs; results are immutable
// `{bytes, text}` pairs, so sharing never lets one guard mutate
// another guard's bytes and the verdict stays a pure function of the
// inputs. Errors are cached too: a path that fails keeps failing the
// same way inside the evaluation.
import type { Fs, Result } from "./index.ts";

export interface LossyText {
	readonly bytes: number;
	readonly text: string;
}

const caches = new WeakMap<Fs, Map<string, Promise<Result<LossyText>>>>();

const decoder = new TextDecoder("utf-8", { fatal: false });

export function cachedLossyText(
	fs: Fs,
	path: string,
): Promise<Result<LossyText>> {
	let perFs = caches.get(fs);
	if (perFs === undefined) {
		perFs = new Map<string, Promise<Result<LossyText>>>();
		caches.set(fs, perFs);
	}
	const hit = perFs.get(path);
	if (hit !== undefined) {
		return hit;
	}
	const pending = fs.read(path).then((loaded) => {
		if (!loaded.ok) {
			return loaded;
		}
		return {
			ok: true as const,
			value: {
				bytes: loaded.value.length,
				text: decoder.decode(loaded.value),
			},
		};
	});
	perFs.set(path, pending);
	return pending;
}
