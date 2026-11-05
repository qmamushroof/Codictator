// Red-ledger collection: the only place that touches the OS for the
// suite run (SPEC §3.3: only the kernel owns OS ports; the kernel lands
// later, so this test-support driver is the bootstrap composition root).
// Pure verdict logic lives in src/features/testing/; the base comparison
// is in ./red-ledger-base.ts, the bounded pool in ./red-ledger-pool.ts,
// and the CLI entry in ./red-ledger-runner.ts. Tests under tests/ are
// non-production code per SPEC §3.1, except the core/file-size cap,
// which covers test files (§5.6).
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TestOutcome } from "../../src/features/testing/index.ts";
import { parseLedgerFile, parseTap } from "../../src/features/testing/index.ts";

export interface PackagePaths {
	readonly name: string;
	readonly dir: string;
	readonly testsDir: string;
}

export interface TestChildResult {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;
}

export function repoRoot(): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(here, "..", "..", "..", "..");
}

export function packagePaths(): Array<PackagePaths> {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const packagesDir = path.resolve(here, "..", "..", "..");
	return ["codictator", "vscode"].map((name) => {
		const dir = path.join(packagesDir, name);
		return { name, dir, testsDir: path.join(dir, "tests") };
	});
}

export function discoverTestFiles(testsDir: string): Array<string> {
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

// SPEC §4.10.4 core/test-command-intact: the serial and parallel paths run
// the identical per-file command for the identical file set; both build it
// here so fan-out can never drift from it.
export function testFileArgv(file: string): ReadonlyArray<string> {
	return ["--test", "--test-reporter=tap", file];
}

function runTestFile(file: string): TestChildResult {
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

export function loadLedger(
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
export function collectOneOutcome(
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

export function collectOutcomes(
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
