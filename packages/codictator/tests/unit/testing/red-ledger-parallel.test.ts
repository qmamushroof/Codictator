// SPEC §10.7: the parallel red-ledger pool merges per-file TAP in discovery
// order, fails closed on spawn errors, and keeps the per-file command intact.
import { strict as assert } from "node:assert";
import path from "node:path";
import test from "node:test";
import type { TestOutcome } from "../../../src/features/testing/index.ts";
import {
	evaluateRun,
	formatRunReport,
	parseTap,
} from "../../../src/features/testing/index.ts";
import {
	collectOutcomesAsync,
	isSerialRun,
	resolveJobCount,
	runTestFileAsync,
	type SpawnTestFile,
	type SpawnTestProcess,
	type TestChildResult,
	testFileArgv,
} from "../../support/red-ledger-runner.ts";

function relativePosix(dir: string, file: string): string {
	return path.relative(dir, file).split(path.sep).join("/");
}

function passTap(titles: ReadonlyArray<string>): string {
	const lines = ["TAP version 13"];
	titles.forEach((title, index) => {
		lines.push(`ok ${index + 1} - ${title}`);
	});
	lines.push(`1..${titles.length}`);
	return lines.join("\n");
}

function mixedTap(): string {
	return [
		"TAP version 13",
		"ok 1 - [§1.1] alpha",
		"not ok 2 - [§1.1] beta",
		"1..2",
	].join("\n");
}

function serialExpectations(
	dir: string,
	files: ReadonlyArray<string>,
	taps: ReadonlyMap<string, string>,
): Array<TestOutcome> {
	const expected: Array<TestOutcome> = [];
	for (const file of files) {
		for (const outcome of parseTap(taps.get(file) ?? "", file).outcomes) {
			expected.push({
				file: relativePosix(dir, file),
				title: outcome.title,
				passed: outcome.passed,
			});
		}
	}
	return expected;
}

function deferredChildren(
	taps: ReadonlyMap<string, string>,
	exits: ReadonlyMap<string, number>,
	stderrFor: (file: string) => string,
): {
	readonly spawn: SpawnTestFile;
	readonly calls: Array<string>;
	readonly releases: Array<() => void>;
} {
	const calls: Array<string> = [];
	const releases: Array<() => void> = [];
	const spawn: SpawnTestFile = (file) =>
		new Promise<TestChildResult>((resolve) => {
			calls.push(file);
			releases.push(() => {
				resolve({
					stdout: taps.get(file) ?? "",
					stderr: stderrFor(file),
					exitCode: exits.get(file) ?? 0,
				});
			});
		});
	return { spawn, calls, releases };
}

test("[§10.7] parallel collectOutcomes preserves serial order and verdict bytes", async () => {
	const dir = path.join("parallel-pkg");
	const pkg = { name: "codictator", dir, testsDir: path.join(dir, "tests") };
	const fileA = path.join(pkg.testsDir, "a.test.ts");
	const fileB = path.join(pkg.testsDir, "b.test.ts");
	const fileC = path.join(pkg.testsDir, "c.test.ts");
	const files = [fileA, fileB, fileC];
	const taps = new Map([
		[fileA, passTap(["[§1.1] alpha"])],
		[fileB, mixedTap()],
		[fileC, passTap(["[§1.1] gamma"])],
	]);
	const exits = new Map([
		[fileA, 0],
		[fileB, 1],
		[fileC, 0],
	]);
	const deferred = deferredChildren(taps, exits, (file) =>
		file === fileB ? "failing child output" : "",
	);
	const pending = collectOutcomesAsync(pkg, files, 3, deferred.spawn);
	assert.equal(deferred.calls.length, 3);
	for (const release of [...deferred.releases].reverse()) {
		release();
	}
	const collected = await pending;
	const expected = serialExpectations(dir, files, taps);
	assert.deepEqual(collected.outcomes, expected);
	assert.deepEqual(
		evaluateRun([], collected.outcomes),
		evaluateRun([], expected),
	);
	assert.equal(
		collected.detailLines[0]?.startsWith(
			`--- failure detail: ${relativePosix(dir, fileB)}`,
		),
		true,
	);
	assert.deepEqual([...deferred.calls].sort(), [...files].sort());
});

test("[§10.7] spawn failure fails closed, never skipped", async () => {
	const dir = path.join("parallel-fail-closed");
	const pkg = { name: "codictator", dir, testsDir: path.join(dir, "tests") };
	const fileA = path.join(pkg.testsDir, "a.test.ts");
	const fileB = path.join(pkg.testsDir, "b.test.ts");
	const fileC = path.join(pkg.testsDir, "c.test.ts");
	const spawn: SpawnTestFile = (file) => {
		if (file === fileA) {
			return Promise.resolve({
				stdout: passTap(["[§1.1] alpha"]),
				stderr: "",
				exitCode: 0,
			});
		}
		if (file === fileB) {
			return Promise.reject(new Error("boom"));
		}
		return Promise.reject(undefined);
	};
	const collected = await collectOutcomesAsync(
		pkg,
		[fileA, fileB, fileC],
		2,
		spawn,
	);
	const relativeB = relativePosix(dir, fileB);
	const relativeC = relativePosix(dir, fileC);
	assert.deepEqual(
		collected.outcomes.filter((outcome) => outcome.file === relativeB),
		[{ file: relativeB, title: "(file failed to load)", passed: false }],
	);
	assert.deepEqual(
		collected.outcomes.filter((outcome) => outcome.file === relativeC),
		[{ file: relativeC, title: "(file failed to load)", passed: false }],
	);
	assert.equal(
		collected.outcomes.some((outcome) => outcome.title === "[§1.1] alpha"),
		true,
	);
	assert.equal(evaluateRun([], collected.outcomes).ok, false);
	assert.equal(
		collected.detailLines.some((line) => line.includes(relativeB)),
		true,
	);
	assert.equal(collected.highWaterMark, 2);
});

test("[§10.4] report keeps raw outcomes under parallel merge", async () => {
	const dir = path.join("parallel-report");
	const pkg = { name: "codictator", dir, testsDir: path.join(dir, "tests") };
	const fileA = path.join(pkg.testsDir, "a.test.ts");
	const fileB = path.join(pkg.testsDir, "b.test.ts");
	const files = [fileA, fileB];
	const taps = new Map([
		[fileA, passTap(["[§1.1] alpha", "[§1.1] beta"])],
		[fileB, mixedTap()],
	]);
	const exits = new Map([
		[fileA, 0],
		[fileB, 1],
	]);
	const spawn: SpawnTestFile = (file) =>
		Promise.resolve({
			stdout: taps.get(file) ?? "",
			stderr: "",
			exitCode: exits.get(file) ?? 0,
		});
	const collected = await collectOutcomesAsync(pkg, files, 2, spawn);
	const verdict = evaluateRun([], collected.outcomes);
	const expected = serialExpectations(dir, files, taps);
	assert.equal(
		formatRunReport([{ packageName: "codictator", verdict }]),
		formatRunReport([
			{ packageName: "codictator", verdict: evaluateRun([], expected) },
		]),
	);
	assert.equal(verdict.ok, false);
});

test("[§4.10.4] test command intact under parallel runner", () => {
	const file = path.join("parallel-pkg", "tests", "a.test.ts");
	assert.deepEqual(testFileArgv(file), ["--test", "--test-reporter=tap", file]);
});

test("[§4.10.4] async spawn keeps failing child output like the sync path", async () => {
	const file = path.join("parallel-pkg", "tests", "a.test.ts");
	const seen: Array<ReadonlyArray<string>> = [];
	const failing: SpawnTestProcess = (args, callback) => {
		seen.push(args);
		callback(new Error("boom"), mixedTap(), "");
	};
	const child = await runTestFileAsync(file, failing);
	assert.deepEqual(seen, [testFileArgv(file)]);
	assert.equal(child.exitCode, 1);
	assert.match(child.stdout, /not ok 2 - /);
	assert.equal(child.stderr, "");
	const silent: SpawnTestProcess = (_args, callback) => {
		callback(new Error("boom"), "", "");
	};
	const dropped = await runTestFileAsync(file, silent);
	assert.equal(dropped.exitCode, 1);
	assert.equal(dropped.stdout, "");
	assert.equal(dropped.stderr, "boom");
});

test("[§10.5] job count resolves from argv, environment, then default", () => {
	assert.equal(resolveJobCount([], {}), 8);
	assert.equal(resolveJobCount([], { CODICTATOR_TEST_JOBS: "2" }), 2);
	assert.equal(
		resolveJobCount(["--jobs", "3"], { CODICTATOR_TEST_JOBS: "2" }),
		3,
	);
	assert.equal(resolveJobCount([], { CODICTATOR_TEST_JOBS: "banana" }), 8);
	assert.equal(resolveJobCount(["--jobs", "banana"], {}), 8);
	assert.equal(resolveJobCount([], { CODICTATOR_TEST_JOBS: "100" }), 32);
	assert.equal(isSerialRun(["--serial"], {}), true);
	assert.equal(isSerialRun([], { CODICTATOR_SERIAL: "1" }), true);
	assert.equal(isSerialRun([], {}), false);
});

test("[§10.5] parallel pool never exceeds its job bound", async () => {
	const dir = path.join("parallel-bound");
	const pkg = { name: "codictator", dir, testsDir: path.join(dir, "tests") };
	const files = [
		"a.test.ts",
		"b.test.ts",
		"c.test.ts",
		"d.test.ts",
		"e.test.ts",
	].map((base) => path.join(pkg.testsDir, base));
	let live = 0;
	let peak = 0;
	const releases: Array<() => void> = [];
	const spawn: SpawnTestFile = () => {
		live += 1;
		peak = Math.max(peak, live);
		return new Promise<TestChildResult>((resolve) => {
			releases.push(() => {
				live -= 1;
				resolve({ stdout: passTap(["[§1.1] x"]), stderr: "", exitCode: 0 });
			});
		});
	};
	const pending = collectOutcomesAsync(pkg, files, 2, spawn);
	assert.equal(releases.length, 2);
	while (releases.length > 0) {
		const release = releases.shift();
		if (release === undefined) {
			break;
		}
		release();
		await Promise.resolve();
	}
	const collected = await pending;
	assert.equal(collected.outcomes.length, 5);
	assert.equal(peak, 2);
	assert.equal(collected.highWaterMark, 2);
});
