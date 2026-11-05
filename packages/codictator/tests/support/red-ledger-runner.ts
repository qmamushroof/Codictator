// Red-ledger runner driver: the only place that touches the OS for the suite
// run (SPEC §3.3: only the kernel owns OS ports; the kernel lands later, so
// this test-support driver is the bootstrap composition root and arch rules
// treat tests/ as non-production code per SPEC §3.1). The verdict logic it
// drives is pure and lives in src/features/testing/.
import { execFile, execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
	FailureMode,
	PackageRunReport,
	TestOutcome,
} from "../../src/features/testing/index.ts";
import {
	evaluateRun,
	filterRedByCovers,
	findNewlyListed,
	formatRunReport,
	parseCoverSpecifier,
	parseLedgerFile,
	parseTap,
	splitTestId,
} from "../../src/features/testing/index.ts";

interface PackagePaths {
	readonly name: string;
	readonly dir: string;
	readonly testsDir: string;
}

interface RunArgs {
	readonly mode: "run";
}

interface QueryArgs {
	readonly mode: "query";
	readonly covers: ReadonlyArray<string>;
	readonly packages: ReadonlyArray<string>;
}

interface BaseArgs {
	readonly mode: "base";
	readonly baseRef: string;
}

type Args = RunArgs | QueryArgs | BaseArgs;

export interface BaseRunInput {
	readonly outcomes: ReadonlyArray<TestOutcome>;
	readonly headRed: ReadonlyArray<string>;
	readonly baseRed: ReadonlyArray<string>;
	readonly baseTestIds: ReadonlyArray<string>;
	readonly baseRef: string;
}

export interface BaseApplied {
	readonly applied: true;
	readonly exitCode: 0 | 1;
	readonly failures: ReadonlyArray<{
		readonly mode: FailureMode;
		readonly testId: string;
	}>;
}

// SPEC §10.7 Adding rule: exit 0 iff the head ledger verdict is clean and no
// base test is newly listed; failures names every surviving mode.
export function runBaseComparison(input: BaseRunInput): BaseApplied {
	const verdict = evaluateRun(input.headRed, input.outcomes);
	const failures: Array<{
		readonly mode: FailureMode;
		readonly testId: string;
	}> = [...verdict.violations];
	for (const testId of findNewlyListed(
		input.baseRed,
		input.headRed,
		input.baseTestIds,
	)) {
		failures.push({ mode: "newly-listed", testId });
	}
	return {
		applied: true,
		exitCode: failures.length === 0 ? 0 : 1,
		failures,
	};
}

function repoRoot(): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(here, "..", "..", "..", "..");
}

function gitShowFile(
	root: string,
	rev: string,
	file: string,
): string | undefined {
	try {
		return execFileSync("git", ["show", `${rev}:${file}`], {
			cwd: root,
			encoding: "utf8",
			maxBuffer: 10 * 1024 * 1024,
			stdio: ["ignore", "pipe", "ignore"],
		});
	} catch {
		// SPEC §10.7 Adding rule: absence at the base is a defined
		// non-violation, so only content the base revision has can be newly
		// listed. The revision itself is verified up front instead.
		return undefined;
	}
}

function verifyBaseRef(root: string, baseRef: string): void {
	try {
		execFileSync("git", ["rev-parse", "--verify", baseRef], {
			cwd: root,
			stdio: "ignore",
		});
	} catch {
		throw new Error(
			`unknown base revision for the ledger comparison; fetch it before comparing`,
		);
	}
}

function baseTestIdsFor(
	root: string,
	packageName: string,
	baseRef: string,
	headRed: ReadonlyArray<string>,
	baseRed: ReadonlyArray<string>,
): Array<string> {
	const listedBefore = new Set(baseRed);
	const preExisting: Array<string> = [];
	for (const entry of headRed) {
		if (listedBefore.has(entry)) {
			continue;
		}
		const split = splitTestId(entry);
		if (split === undefined) {
			continue;
		}
		const baseContent = gitShowFile(
			root,
			baseRef,
			`packages/${packageName}/${split.file}`,
		);
		if (baseContent?.includes(split.title)) {
			preExisting.push(entry);
		}
	}
	return preExisting;
}

interface BasePackagePlan {
	readonly pkg: PackagePaths;
	readonly baseRef: string;
	readonly headRed: ReadonlyArray<string>;
	readonly baseRed: ReadonlyArray<string>;
	readonly baseTestIds: ReadonlyArray<string>;
}

function basePackagePlan(
	root: string,
	pkg: PackagePaths,
	baseRef: string,
): BasePackagePlan {
	const ledger = loadLedger(pkg.testsDir, pkg.name);
	const headRed: ReadonlyArray<string> = ledger.red;
	const baseText = gitShowFile(
		root,
		baseRef,
		`packages/${pkg.name}/tests/red-ledger.json`,
	);
	const baseRed: ReadonlyArray<string> =
		baseText === undefined ? [] : parseLedgerFile(JSON.parse(baseText)).red;
	const baseTestIds = baseTestIdsFor(root, pkg.name, baseRef, headRed, baseRed);
	return { pkg, baseRef, headRed, baseRed, baseTestIds };
}

function renderBasePackage(
	plan: BasePackagePlan,
	collected: {
		readonly outcomes: ReadonlyArray<TestOutcome>;
		readonly detailLines: ReadonlyArray<string>;
	},
): {
	readonly failed: boolean;
	readonly lines: Array<string>;
} {
	const compared = runBaseComparison({
		outcomes: collected.outcomes,
		headRed: plan.headRed,
		baseRed: plan.baseRed,
		baseTestIds: plan.baseTestIds,
		baseRef: plan.baseRef,
	});
	const lines: Array<string> = [];
	if (compared.exitCode !== 0) {
		lines.push(`FAIL ${plan.pkg.name} vs ${plan.baseRef}`);
		for (const failure of compared.failures) {
			lines.push(`  ${failure.mode} ${failure.testId}`);
		}
	}
	lines.push(...collected.detailLines);
	return { failed: compared.exitCode !== 0, lines };
}

function finishBaseCheck(
	baseRef: string,
	failed: boolean,
	lines: ReadonlyArray<string>,
): {
	readonly output: string;
	readonly exitCode: number;
} {
	if (!failed) {
		if (lines.length === 0) {
			return {
				output: `ledger base comparison clean vs ${baseRef}`,
				exitCode: 0,
			};
		}
		return {
			output: [`ledger base comparison clean vs ${baseRef}`, ...lines].join(
				"\n",
			),
			exitCode: 0,
		};
	}
	return { output: lines.join("\n"), exitCode: 1 };
}

function runBaseCheck(baseRef: string): {
	readonly output: string;
	readonly exitCode: number;
} {
	const root = repoRoot();
	verifyBaseRef(root, baseRef);
	const lines: Array<string> = [];
	let failed = false;
	for (const pkg of packagePaths()) {
		const plan = basePackagePlan(root, pkg, baseRef);
		const rendered = renderBasePackage(
			plan,
			collectOutcomes(pkg, discoverTestFiles(pkg.testsDir)),
		);
		failed = failed || rendered.failed;
		lines.push(...rendered.lines);
	}
	return finishBaseCheck(baseRef, failed, lines);
}

async function runBaseCheckAsync(
	baseRef: string,
	jobs: number,
	spawn: SpawnTestFile = runTestFileAsync,
): Promise<{
	readonly output: string;
	readonly exitCode: number;
}> {
	const root = repoRoot();
	verifyBaseRef(root, baseRef);
	const lines: Array<string> = [];
	let failed = false;
	for (const pkg of packagePaths()) {
		const plan = basePackagePlan(root, pkg, baseRef);
		const rendered = renderBasePackage(
			plan,
			await collectOutcomesAsync(
				pkg,
				discoverTestFiles(pkg.testsDir),
				jobs,
				spawn,
			),
		);
		failed = failed || rendered.failed;
		lines.push(...rendered.lines);
	}
	return finishBaseCheck(baseRef, failed, lines);
}

function packagePaths(): Array<PackagePaths> {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const packagesDir = path.resolve(here, "..", "..", "..");
	return ["codictator", "vscode"].map((name) => {
		const dir = path.join(packagesDir, name);
		return { name, dir, testsDir: path.join(dir, "tests") };
	});
}

function discoverTestFiles(testsDir: string): Array<string> {
	const found: Array<string> = [];
	const walk = (dir: string): void => {
		const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
			a.name < b.name ? -1 : 1,
		);
		for (const entry of entries) {
			if (entry.name === "node_modules") {
				continue;
			}
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
				found.push(full);
			}
		}
	};
	walk(testsDir);
	return found;
}

function toPosixPath(value: string): string {
	return value.split(path.sep).join("/");
}

function runTestFile(file: string): {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;
} {
	try {
		const stdout = execFileSync(process.execPath, testFileArgv(file), {
			encoding: "utf8",
			maxBuffer: 10 * 1024 * 1024,
		});
		return { stdout: stdout, stderr: "", exitCode: 0 };
	} catch (error) {
		return {
			stdout: childText(error, "stdout"),
			stderr: childText(error, "stderr"),
			exitCode: 1,
		};
	}
}

// SPEC §4.10.4 core/test-command-intact: the serial and parallel paths run
// the identical per-file command for the identical file set; both build it
// here so fan-out can never drift from it.
export function testFileArgv(file: string): ReadonlyArray<string> {
	return ["--test", "--test-reporter=tap", file];
}

export interface TestChildResult {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;
}

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

function childText(error: unknown, key: string): string {
	if (typeof error === "object" && error !== null && key in error) {
		const value = (error as Record<string, unknown>)[key];
		if (typeof value === "string") {
			return value;
		}
	}
	return "";
}

// Reporting only: not-ok-anchored excerpt of a failed child's captured
// output so the failing TAP assert (message + stack) is visible instead of
// swallowed by the summary report. A trailing tail demonstrably misses the
// assert when later passing tests scroll past it, so anchor on each `not ok`
// line plus following context, capped per file. Never affects pass/fail
// classification.
const FAILURE_CONTEXT_LINES = 25;
const MAX_FAILURE_DETAIL_LINES = 120;

function failureExcerptLines(text: string): Array<string> {
	const lines = text.split(/\r?\n/);
	while (lines.length > 0 && lines[lines.length - 1] === "") {
		lines.pop();
	}
	const excerpt: Array<string> = [];
	for (let index = 0; index < lines.length; index += 1) {
		if (!/^\s*not ok\b/.test(lines[index] ?? "")) {
			continue;
		}
		for (
			let offset = 0;
			offset <= FAILURE_CONTEXT_LINES &&
			index + offset < lines.length &&
			excerpt.length < MAX_FAILURE_DETAIL_LINES;
			offset += 1
		) {
			excerpt.push(lines[index + offset] ?? "");
		}
		if (excerpt.length >= MAX_FAILURE_DETAIL_LINES) {
			break;
		}
	}
	if (excerpt.length > 0) {
		return excerpt;
	}
	return lines.slice(Math.max(0, lines.length - FAILURE_CONTEXT_LINES - 1));
}

function childFailureDetail(
	relative: string,
	child: { readonly stdout: string; readonly stderr: string },
): Array<string> {
	const combined = [child.stdout, child.stderr]
		.filter((part) => part !== "")
		.join("\n");
	const excerpt =
		combined === "" ? ["(no captured output)"] : failureExcerptLines(combined);
	return [
		`--- failure detail: ${relative} (not ok + ${FAILURE_CONTEXT_LINES} lines context) ---`,
		...excerpt,
		`--- end failure detail: ${relative} ---`,
	];
}

function loadLedger(
	testsDir: string,
	packageName: string,
): { readonly version: 1; readonly red: ReadonlyArray<string> } {
	let text: string;
	try {
		text = readFileSync(path.join(testsDir, "red-ledger.json"), "utf8");
	} catch {
		throw new Error(
			`missing red ledger for package ${packageName}; add tests/red-ledger.json per SPEC §10.7`,
		);
	}
	try {
		return parseLedgerFile(JSON.parse(text));
	} catch (error) {
		const reason = error instanceof Error ? error.message : "invalid JSON";
		throw new Error(`invalid red ledger for package ${packageName}: ${reason}`);
	}
}

// Per-file merge shared by the serial and parallel paths: identical TAP
// mapping, identical synthetic load failures, identical failure detail, so
// both verdicts agree byte for byte on the same child outputs.
function collectOneOutcome(
	pkg: PackagePaths,
	file: string,
	child: TestChildResult,
): {
	readonly outcomes: Array<TestOutcome>;
	readonly detailLines: Array<string>;
} {
	const relative = toPosixPath(path.relative(pkg.dir, file));
	const tap = parseTap(child.stdout, file);
	const outcomes: Array<TestOutcome> = [];
	const detailLines: Array<string> = [];
	for (const outcome of tap.outcomes) {
		outcomes.push({
			file: relative,
			title: outcome.title,
			passed: outcome.passed,
		});
	}
	if (tap.loadFailed) {
		outcomes.push({
			file: relative,
			title: "(file failed to load)",
			passed: false,
		});
	}
	if (
		tap.outcomes.length === 0 &&
		!tap.loadFailed &&
		child.exitCode !== 0 &&
		child.stderr !== ""
	) {
		outcomes.push({
			file: relative,
			title: "(file failed to load)",
			passed: false,
		});
	}
	if (child.exitCode !== 0) {
		detailLines.push(...childFailureDetail(relative, child));
	}
	return { outcomes, detailLines };
}

function collectOutcomes(
	pkg: PackagePaths,
	files: ReadonlyArray<string>,
): {
	readonly outcomes: Array<TestOutcome>;
	readonly detailLines: Array<string>;
} {
	const outcomes: Array<TestOutcome> = [];
	const detailLines: Array<string> = [];
	for (const file of files) {
		const one = collectOneOutcome(pkg, file, runTestFile(file));
		outcomes.push(...one.outcomes);
		detailLines.push(...one.detailLines);
	}
	return { outcomes, detailLines };
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

function renderSuiteOutput(
	reports: ReadonlyArray<PackageRunReport>,
	detail: ReadonlyArray<string>,
): {
	readonly output: string;
	readonly exitCode: number;
} {
	const ok = reports.every((report) => report.verdict.ok);
	return {
		output: [formatRunReport(reports), ...detail].join("\n"),
		exitCode: ok ? 0 : 1,
	};
}

export function runSuite(): {
	readonly output: string;
	readonly exitCode: number;
} {
	const detail: Array<string> = [];
	const reports: Array<PackageRunReport> = packagePaths().map((pkg) => {
		const ledger = loadLedger(pkg.testsDir, pkg.name);
		const collected = collectOutcomes(pkg, discoverTestFiles(pkg.testsDir));
		detail.push(...collected.detailLines);
		return {
			packageName: pkg.name,
			verdict: evaluateRun(ledger.red, collected.outcomes),
		};
	});
	return renderSuiteOutput(reports, detail);
}

export async function runSuiteAsync(
	jobs: number,
	spawn: SpawnTestFile = runTestFileAsync,
): Promise<{
	readonly output: string;
	readonly exitCode: number;
}> {
	const detail: Array<string> = [];
	const reports: Array<PackageRunReport> = [];
	for (const pkg of packagePaths()) {
		const ledger = loadLedger(pkg.testsDir, pkg.name);
		const collected = await collectOutcomesAsync(
			pkg,
			discoverTestFiles(pkg.testsDir),
			jobs,
			spawn,
		);
		detail.push(...collected.detailLines);
		reports.push({
			packageName: pkg.name,
			verdict: evaluateRun(ledger.red, collected.outcomes),
		});
	}
	return renderSuiteOutput(reports, detail);
}

export function queryLedger(
	covers: ReadonlyArray<string>,
	only: ReadonlyArray<string>,
): { readonly output: string; readonly exitCode: number } {
	const filters = covers.map((spec) => {
		const filter = parseCoverSpecifier(spec);
		if (filter === undefined) {
			throw new Error(
				`invalid --covers reference ${spec}; use §4.1, §4.3 EC-7, or §4.3 EC-5..7`,
			);
		}
		return filter;
	});
	const lines: Array<string> = [];
	let remaining = 0;
	for (const pkg of packagePaths()) {
		if (only.length > 0 && !only.includes(pkg.name)) {
			continue;
		}
		const ledger = loadLedger(pkg.testsDir, pkg.name);
		const entries = filterRedByCovers(ledger.red, filters);
		remaining += entries.length;
		lines.push(`## ${pkg.name}`);
		for (const entry of entries) {
			lines.push(entry);
		}
	}
	if (remaining === 0) {
		lines.push("(no red entries)");
	}
	return { output: lines.join("\n"), exitCode: remaining > 0 ? 1 : 0 };
}

const USAGE =
	"usage: red-ledger-runner.ts [--ledger [--covers <ref>] [--package <name>] | --base <ref>] [--serial] [--jobs <n>]";

function parseArgs(argv: ReadonlyArray<string>): Args {
	let ledger = false;
	const covers: Array<string> = [];
	const packages: Array<string> = [];
	let baseRef: string | undefined;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--ledger") {
			ledger = true;
		} else if (arg === "--serial" || arg === "--jobs") {
			// Pool flags belong to parsePoolOptions; consume the --jobs value
			// here so mode parsing stays total over the argv it accepts.
			if (arg === "--jobs") {
				if (argv[index + 1] === undefined) {
					throw new Error(USAGE);
				}
				index += 1;
			}
		} else if (arg === "--covers") {
			const value = argv[index + 1];
			if (value === undefined) {
				throw new Error(USAGE);
			}
			index += 1;
			covers.push(value);
		} else if (arg === "--package") {
			const value = argv[index + 1];
			if (value === undefined) {
				throw new Error(USAGE);
			}
			index += 1;
			packages.push(value);
		} else if (arg === "--base") {
			const value = argv[index + 1];
			if (value === undefined) {
				throw new Error(USAGE);
			}
			index += 1;
			baseRef = value;
		} else if (arg === "--help") {
			throw new Error(USAGE);
		} else {
			throw new Error(`unknown argument ${arg ?? ""}; ${USAGE}`);
		}
	}
	if (baseRef !== undefined) {
		return { mode: "base", baseRef };
	}
	if (ledger) {
		return { mode: "query", covers, packages };
	}
	if (covers.length > 0 || packages.length > 0) {
		throw new Error("--covers and --package need --ledger");
	}
	return { mode: "run" };
}

async function mainAsync(): Promise<void> {
	let result: { readonly output: string; readonly exitCode: number };
	try {
		const argv = process.argv.slice(2);
		const args = parseArgs(argv);
		const pool = parsePoolOptions(argv);
		if (args.mode === "query") {
			result = queryLedger(args.covers, args.packages);
		} else if (args.mode === "base") {
			if (pool.serial) {
				result = runBaseCheck(args.baseRef);
			} else {
				result = await runBaseCheckAsync(args.baseRef, pool.jobs);
			}
		} else if (pool.serial) {
			result = runSuite();
		} else {
			result = await runSuiteAsync(pool.jobs);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : "unknown failure";
		process.exitCode = 2;
		console.error(`error: ${message}`);
		return;
	}
	process.exitCode = result.exitCode;
	console.log(result.output);
}

const invokedAsScript =
	path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url);

if (invokedAsScript) {
	mainAsync().catch((error: unknown) => {
		const message = error instanceof Error ? error.message : "unknown failure";
		process.exitCode = 2;
		console.error(`error: ${message}`);
	});
}
