// SPEC §10.2: a scripted Proc port for unit tests (SPEC §4.1.1). Handlers are
// keyed by exact argv, every call is recorded in order so tests can assert
// exact spawn sequences, and unmatched argv gets a zero exit.
import type { Proc, ProcOptions, ProcResult } from "../../src/kernel/index.ts";

export interface RecordedProcCall {
	readonly argv: ReadonlyArray<string>;
	readonly options: ProcOptions;
}

const DEFAULT_RESULT: ProcResult = {
	code: 0,
	stdout: "",
	stderr: "",
	timedOut: false,
	truncated: false,
};

export class FakeProc implements Proc {
	private readonly handlers = new Map<string, ProcResult>();
	private readonly hangs = new Set<string>();
	private readonly invocations: Array<RecordedProcCall> = [];
	private fallback: ProcResult = DEFAULT_RESULT;

	when(argv: ReadonlyArray<string>, result: ProcResult): void {
		this.handlers.set(JSON.stringify(argv), result);
	}

	// SPEC §4.1.3 EC-6: the script never exits on its own, so the run
	// reports the timeout tree-kill at once; no wall-clock wait, per
	// CONVENTIONS, keeps the suite deterministic.
	whenHang(argv: ReadonlyArray<string>): void {
		this.hangs.add(JSON.stringify(argv));
	}

	whenMissing(result: ProcResult): void {
		this.fallback = result;
	}

	get calls(): ReadonlyArray<RecordedProcCall> {
		return this.invocations;
	}

	run(argv: ReadonlyArray<string>, options: ProcOptions): Promise<ProcResult> {
		this.invocations.push({ argv: [...argv], options });
		if (this.hangs.has(JSON.stringify(argv))) {
			return Promise.resolve({
				code: -1,
				stdout: "",
				stderr: "",
				timedOut: true,
				truncated: false,
			});
		}
		const result = this.handlers.get(JSON.stringify(argv)) ?? this.fallback;
		// SPEC §4.1.1: past the cap the tree dies and the caller sees
		// truncated output, like NodeProc's pushChunk; the fake applies it
		// to the resolved script instead of a live stream.
		return Promise.resolve(enforceCap(result, options.maxOutputBytes));
	}
}

function enforceCap(result: ProcResult, maxOutputBytes: number): ProcResult {
	const encoder = new TextEncoder();
	const outBytes = encoder.encode(result.stdout);
	const errBytes = encoder.encode(result.stderr);
	if (outBytes.length + errBytes.length <= maxOutputBytes) {
		return result;
	}
	let room = maxOutputBytes;
	const take = (bytes: Uint8Array): string => {
		const kept = bytes.subarray(0, room);
		room -= kept.length;
		return new TextDecoder().decode(kept);
	};
	const stdout = take(outBytes);
	const stderr = take(errBytes);
	return {
		code: result.code,
		stdout,
		stderr,
		timedOut: result.timedOut,
		truncated: true,
	};
}
