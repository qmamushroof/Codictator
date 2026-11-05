// Red-ledger base comparison: the CI ledger check (SPEC §10.7) over a
// caller-supplied base revision. Collection comes from
// ./red-ledger-collect.ts, the bounded pool from ./red-ledger-pool.ts;
// the CLI entry stays in ./red-ledger-runner.ts.
import { execFileSync } from "node:child_process";
import type {
	FailureMode,
	TestOutcome,
} from "../../src/features/testing/index.ts";
import {
	evaluateRun,
	findNewlyListed,
	parseLedgerFile,
	splitTestId,
} from "../../src/features/testing/index.ts";
import {
	collectOutcomes,
	discoverTestFiles,
	loadLedger,
	type PackagePaths,
	packagePaths,
	repoRoot,
} from "./red-ledger-collect.ts";
import {
	collectOutcomesAsync,
	runTestFileAsync,
	type SpawnTestFile,
} from "./red-ledger-pool.ts";

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

export function runBaseCheck(baseRef: string): {
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

export async function runBaseCheckAsync(
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
