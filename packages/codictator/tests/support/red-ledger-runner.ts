// Red-ledger runner driver: the CLI entry (`npm test`, `--ledger`,
// `--base`) over collection (./red-ledger-collect.ts), the bounded pool
// (./red-ledger-pool.ts), and the base comparison (./red-ledger-base.ts).
// The verdict logic it drives is pure and lives in
// src/features/testing/. Tests under tests/ are non-production code per
// SPEC §3.1, except the core/file-size cap, which covers test files
// (§5.6).
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PackageRunReport } from "../../src/features/testing/index.ts";
import {
	evaluateRun,
	filterRedByCovers,
	formatRunReport,
	parseCoverSpecifier,
} from "../../src/features/testing/index.ts";
import { runBaseCheck, runBaseCheckAsync } from "./red-ledger-base.ts";
import {
	collectOutcomes,
	discoverTestFiles,
	loadLedger,
	packagePaths,
} from "./red-ledger-collect.ts";
import {
	collectOutcomesAsync,
	isSerialRun,
	parsePoolOptions,
	resolveJobCount,
	runTestFileAsync,
	type SpawnTestFile,
	type SpawnTestProcess,
	type TestChildResult,
	testFileArgv,
} from "./red-ledger-pool.ts";

// Test seams live in the pool module; the runner re-exports them so the
// parallel ledger tests keep importing from this entry.
export {
	collectOutcomesAsync,
	isSerialRun,
	resolveJobCount,
	runTestFileAsync,
	type SpawnTestFile,
	type SpawnTestProcess,
	type TestChildResult,
	testFileArgv,
};

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
