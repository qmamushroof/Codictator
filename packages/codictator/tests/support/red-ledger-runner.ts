// Red-ledger runner driver: the only place that touches the OS for the suite
// run (SPEC §3.3: only the kernel owns OS ports; the kernel lands later, so
// this test-support driver is the bootstrap composition root and arch rules
// treat tests/ as non-production code per SPEC §3.1). The verdict logic it
// drives is pure and lives in src/testing/.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FailureMode, TestOutcome } from "../../src/testing/index.ts";
import {
	evaluateRun,
	filterRedByCovers,
	formatRunReport,
	parseCoverSpecifier,
	parseLedgerFile,
	parseTap,
} from "../../src/testing/index.ts";

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

export interface BaseDeferred {
	readonly applied: false;
	readonly exitCode: 2;
	readonly remediation: string;
}

export type BaseRunResult = BaseApplied | BaseDeferred;

// SPEC §10.7 Adding rule enforcement (git base resolution) lands with the CI
// workflow in step 1.8. This contract is what 1.8 implements: applied true,
// exit 0 iff the head ledger verdict is clean and no base test is newly
// listed, failures naming each surviving mode.
export function runBaseComparison(_input: BaseRunInput): BaseRunResult {
	return {
		applied: false,
		exitCode: 2,
		remediation:
			"ledger base comparison lands with the CI workflow in step 1.8; re-run then",
	};
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
		const stdout = execFileSync(
			process.execPath,
			["--test", "--test-reporter=tap", file],
			{
				encoding: "utf8",
				maxBuffer: 10 * 1024 * 1024,
			},
		);
		return { stdout: stdout, stderr: "", exitCode: 0 };
	} catch (error) {
		return {
			stdout: childText(error, "stdout"),
			stderr: childText(error, "stderr"),
			exitCode: 1,
		};
	}
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

function collectOutcomes(
	pkg: PackagePaths,
	files: ReadonlyArray<string>,
): Array<TestOutcome> {
	const outcomes: Array<TestOutcome> = [];
	for (const file of files) {
		const relative = toPosixPath(path.relative(pkg.dir, file));
		const child = runTestFile(file);
		const tap = parseTap(child.stdout, file);
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
	}
	return outcomes;
}

export function runSuite(): {
	readonly output: string;
	readonly exitCode: number;
} {
	const reports = packagePaths().map((pkg) => {
		const ledger = loadLedger(pkg.testsDir, pkg.name);
		const outcomes = collectOutcomes(pkg, discoverTestFiles(pkg.testsDir));
		return {
			packageName: pkg.name,
			verdict: evaluateRun(ledger.red, outcomes),
		};
	});
	const ok = reports.every((report) => report.verdict.ok);
	return { output: formatRunReport(reports), exitCode: ok ? 0 : 1 };
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

function parseArgs(argv: ReadonlyArray<string>): Args {
	let ledger = false;
	const covers: Array<string> = [];
	const packages: Array<string> = [];
	let baseRef: string | undefined;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--ledger") {
			ledger = true;
		} else if (arg === "--covers") {
			const value = argv[index + 1];
			if (value === undefined) {
				throw new Error(
					"usage: red-ledger-runner.ts [--ledger [--covers <ref>] [--package <name>] | --base <ref>]",
				);
			}
			index += 1;
			covers.push(value);
		} else if (arg === "--package") {
			const value = argv[index + 1];
			if (value === undefined) {
				throw new Error(
					"usage: red-ledger-runner.ts [--ledger [--covers <ref>] [--package <name>] | --base <ref>]",
				);
			}
			index += 1;
			packages.push(value);
		} else if (arg === "--base") {
			const value = argv[index + 1];
			if (value === undefined) {
				throw new Error(
					"usage: red-ledger-runner.ts [--ledger [--covers <ref>] [--package <name>] | --base <ref>]",
				);
			}
			index += 1;
			baseRef = value;
		} else if (arg === "--help") {
			throw new Error(
				"usage: red-ledger-runner.ts [--ledger [--covers <ref>] [--package <name>] | --base <ref>]",
			);
		} else {
			throw new Error(
				`unknown argument ${arg ?? ""}; usage: red-ledger-runner.ts [--ledger | --base <ref>]`,
			);
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

function main(): void {
	let result: { readonly output: string; readonly exitCode: number };
	try {
		const args = parseArgs(process.argv.slice(2));
		if (args.mode === "query") {
			result = queryLedger(args.covers, args.packages);
		} else if (args.mode === "base") {
			const deferred = runBaseComparison({
				outcomes: [],
				headRed: [],
				baseRed: [],
				baseTestIds: [],
				baseRef: args.baseRef,
			});
			if (deferred.applied) {
				const failures = deferred.failures.map(
					(failure) => `${failure.mode} ${failure.testId}`,
				);
				result = { output: failures.join("\n"), exitCode: deferred.exitCode };
			} else {
				result = { output: deferred.remediation, exitCode: deferred.exitCode };
			}
		} else {
			result = runSuite();
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
	main();
}
