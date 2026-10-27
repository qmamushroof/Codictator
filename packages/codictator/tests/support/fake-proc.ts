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
	private readonly invocations: Array<RecordedProcCall> = [];
	private fallback: ProcResult = DEFAULT_RESULT;

	when(argv: ReadonlyArray<string>, result: ProcResult): void {
		this.handlers.set(JSON.stringify(argv), result);
	}

	whenMissing(result: ProcResult): void {
		this.fallback = result;
	}

	get calls(): ReadonlyArray<RecordedProcCall> {
		return this.invocations;
	}

	run(argv: ReadonlyArray<string>, options: ProcOptions): Promise<ProcResult> {
		this.invocations.push({ argv: [...argv], options });
		const result = this.handlers.get(JSON.stringify(argv)) ?? this.fallback;
		return Promise.resolve(result);
	}
}
