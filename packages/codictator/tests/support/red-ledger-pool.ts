// Red-ledger bounded pool: the async fan-out over the per-file `node --test`
// command (SPEC §10.5 bounded fan-out; SPEC §4.10.4 core/test-command-intact
// pins the shared command in ./red-ledger-collect.ts). Children merge in
// discovery index order so the verdict bytes match the serial path, and
// every spawn failure fails closed. The CLI entry stays in
// ./red-ledger-runner.ts, which re-exports this module's test seams.
import { execFile } from "node:child_process";
import type { TestOutcome } from "../../src/features/testing/index.ts";
import {
	collectOneOutcome,
	type PackagePaths,
	type TestChildResult,
	testFileArgv,
} from "./red-ledger-collect.ts";

export type { TestChildResult } from "./red-ledger-collect.ts";
export { testFileArgv } from "./red-ledger-collect.ts";

export type SpawnTestFile = (file: string) => Promise<TestChildResult>;

// SPEC §10.5 bounded fan-out: one `node --test` child per pool slot. The
// default suits shared CI runners; CODICTATOR_TEST_JOBS / --jobs override it.
const DEFAULT_TEST_JOBS = 8;
const MIN_TEST_JOBS = 1;
const MAX_TEST_JOBS = 32;

// Spawn seam for runTestFileAsync: production passes execFile; tests inject
// a fake to pin the callback capture mapping without spawning real children
// (node --test skips recursive runs, so real children stay empty here).
export type SpawnTestProcess = (
	args: ReadonlyArray<string>,
	callback: (error: unknown, stdout: string, stderr: string) => void,
) => void;

function spawnTestProcess(
	args: ReadonlyArray<string>,
	callback: (error: unknown, stdout: string, stderr: string) => void,
): void {
	execFile(
		process.execPath,
		args,
		{
			encoding: "utf8",
			maxBuffer: 10 * 1024 * 1024,
		},
		(error, stdout, stderr) => {
			callback(error, stdout, stderr);
		},
	);
}

// Async sibling of runTestFile: same command, same buffer, same capture
// mapping (success keeps the empty-stderr shape execFileSync produces). The
// execFile callback carries the child's output in its stdout/stderr
// parameters even on failure; error.stdout is not populated there.
export function runTestFileAsync(
	file: string,
	spawn: SpawnTestProcess = spawnTestProcess,
): Promise<TestChildResult> {
	return new Promise<TestChildResult>((resolve) => {
		spawn(testFileArgv(file), (error, stdout, stderr) => {
			if (error === null) {
				resolve({ stdout, stderr: "", exitCode: 0 });
				return;
			}
			resolve({
				stdout,
				stderr:
					stdout === "" && stderr === "" ? spawnFailureText(error) : stderr,
				exitCode: 1,
			});
		});
	});
}

function parsePositiveInt(raw: string | undefined): number | undefined {
	if (raw === undefined || raw === "") {
		return undefined;
	}
	if (!/^\d+$/.test(raw)) {
		return undefined;
	}
	const value = Number.parseInt(raw, 10);
	if (!Number.isSafeInteger(value) || value <= 0) {
		return undefined;
	}
	return value;
}

function jobsFromArgv(argv: ReadonlyArray<string>): number | undefined {
	for (let index = 0; index < argv.length; index += 1) {
		if (argv[index] === "--jobs") {
			return parsePositiveInt(argv[index + 1]);
		}
	}
	return undefined;
}

export function resolveJobCount(
	argv: ReadonlyArray<string>,
	env: NodeJS.ProcessEnv,
): number {
	const requested =
		jobsFromArgv(argv) ?? parsePositiveInt(env["CODICTATOR_TEST_JOBS"]);
	if (requested === undefined) {
		return DEFAULT_TEST_JOBS;
	}
	return Math.min(Math.max(requested, MIN_TEST_JOBS), MAX_TEST_JOBS);
}

export function isSerialRun(
	argv: ReadonlyArray<string>,
	env: NodeJS.ProcessEnv,
): boolean {
	return argv.includes("--serial") || env["CODICTATOR_SERIAL"] === "1";
}

export interface PoolOptions {
	readonly jobs: number;
	readonly serial: boolean;
}

export function parsePoolOptions(
	argv: ReadonlyArray<string>,
	env: NodeJS.ProcessEnv = process.env,
): PoolOptions {
	return { jobs: resolveJobCount(argv, env), serial: isSerialRun(argv, env) };
}

// SPEC §4.10.4 core/no-skipped-tests: a spawn rejection never drops the
// file. The message below keeps stderr non-empty, so the empty-TAP arm of
// collectOneOutcome records a load failure naming the file.
function spawnFailureText(error: unknown): string {
	if (error instanceof Error && error.message !== "") {
		return error.message;
	}
	return "spawn failed";
}

interface PoolState {
	readonly children: Array<TestChildResult>;
	next: number;
	active: number;
	highWaterMark: number;
}

function takePoolSlot(
	state: PoolState,
	files: ReadonlyArray<string>,
): number | undefined {
	if (state.next >= files.length) {
		return undefined;
	}
	const index = state.next;
	state.next += 1;
	return index;
}

async function runPoolSlot(
	state: PoolState,
	files: ReadonlyArray<string>,
	spawn: SpawnTestFile,
): Promise<void> {
	while (true) {
		const index = takePoolSlot(state, files);
		if (index === undefined) {
			return;
		}
		const file = files[index];
		state.active += 1;
		state.highWaterMark = Math.max(state.highWaterMark, state.active);
		if (file !== undefined) {
			try {
				state.children[index] = await spawn(file);
			} catch (error) {
				state.children[index] = {
					stdout: "",
					stderr: spawnFailureText(error),
					exitCode: 1,
				};
			}
		}
		state.active -= 1;
	}
}

// Bounded worker pool over the file list. Every slot is pre-filled with a
// failing child, so even a worker that never runs fails closed. Results keep
// discovery index order; completion order never leaks into the merge.
async function runPool(
	files: ReadonlyArray<string>,
	jobs: number,
	spawn: SpawnTestFile,
): Promise<{
	readonly children: Array<TestChildResult>;
	readonly highWaterMark: number;
}> {
	const state: PoolState = {
		children: files.map(() => ({
			stdout: "",
			stderr: "spawn failed: worker did not run",
			exitCode: 1,
		})),
		next: 0,
		active: 0,
		highWaterMark: 0,
	};
	const slots = Math.min(
		Math.max(jobs, MIN_TEST_JOBS),
		Math.max(files.length, 1),
	);
	const workers: Array<Promise<void>> = [];
	for (let slot = 0; slot < slots; slot += 1) {
		workers.push(runPoolSlot(state, files, spawn));
	}
	await Promise.all(workers);
	return { children: state.children, highWaterMark: state.highWaterMark };
}

export interface CollectedOutcomes {
	readonly outcomes: Array<TestOutcome>;
	readonly detailLines: Array<string>;
	readonly highWaterMark: number;
}

// SPEC §10.7: parallel collect. Children run under the pool bound, then merge
// strictly in discovery index order, so evaluateRun sees the serial sequence
// and the verdict bytes match. Git probes stay serial in runBaseCheckAsync.
export async function collectOutcomesAsync(
	pkg: PackagePaths,
	files: ReadonlyArray<string>,
	jobs: number,
	spawn: SpawnTestFile,
): Promise<CollectedOutcomes> {
	const pooled = await runPool(files, jobs, spawn);
	const outcomes: Array<TestOutcome> = [];
	const detailLines: Array<string> = [];
	for (const [index, file] of files.entries()) {
		const child: TestChildResult = pooled.children[index] ?? {
			stdout: "",
			stderr: "spawn failed: missing pooled result",
			exitCode: 1,
		};
		const one = collectOneOutcome(pkg, file, child);
		outcomes.push(...one.outcomes);
		detailLines.push(...one.detailLines);
	}
	return { outcomes, detailLines, highWaterMark: pooled.highWaterMark };
}
