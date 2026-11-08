// Shared consumer-repo harness for the Slice 0 conformance suite. Builds a
// temp repo with exactly what `codictator init` writes (real writers) and
// drives the real launcher/CLI entries in child processes. No source greps.
import { strict as assert } from "node:assert";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	HOOK_NAMES,
	renderHookScript,
} from "../../src/features/integrity/hooks.ts";
import { buildManagedBlock } from "../../src/features/steering/index.ts";
import { parseJson } from "../../src/kernel/index.ts";
import { type CliResult, runNodeScript } from "./cli-runner.ts";
import type { TempRepo } from "./temp-repo.ts";

export function packageRoot(): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(here, "..", "..");
}

function launcherSource(): string {
	return readFileSync(
		path.join(packageRoot(), "..", "..", ".codictator", "bin", "run.mjs"),
		"utf8",
	);
}

// Exactly what `codictator init` writes (real writers) plus the engine shim
// at the launcher's SPEC resolution path, so the installed launcher drives
// the current engine with no build.
export function installConsumer(repo: TempRepo): void {
	repo.writeFile(
		".codictator/config.json",
		JSON.stringify({
			version: 1,
			codictator: "unknown",
			packs: [],
			harnesses: ["muse-code", "opencode"],
		}),
	);
	repo.writeFile(".codictator/bin/run.mjs", launcherSource());
	const shimDir = path.join(
		repo.dir,
		"node_modules",
		"codictator",
		"dist",
		"cli",
	);
	mkdirSync(shimDir, { recursive: true });
	const target = pathToFileURL(
		realpathSync(path.join(packageRoot(), "src", "cli", "main.ts")),
	).href;
	writeFileSync(
		path.join(shimDir, "main.js"),
		`export { main } from ${JSON.stringify(target)};\n`,
		"utf8",
	);
	repo.writeFile("AGENTS.md", buildManagedBlock());
	for (const hook of HOOK_NAMES) {
		repo.writeFile(`.githooks/${hook}`, renderHookScript(hook));
	}
	for (const dir of [
		"src",
		"tests",
		"tests/fixtures",
		"docs",
		"docs/HISTORY",
		"docs/BUGS",
		"docs/SPEC/sub",
		"py",
		".github/workflows",
	]) {
		mkdirSync(path.join(repo.dir, dir), { recursive: true });
	}
	repo.commit("consumer guardrails fixture");
}

// The real CLI entry in a child process: the same main() the launcher and
// the built bin call. GITHUB_EVENT_PATH is scrubbed so ambient CI never
// hijacks ranges inside fixtures.
export function srcMain(
	args: ReadonlyArray<string>,
	cwd: string,
): Promise<CliResult> {
	const entry = pathToFileURL(
		path.join(packageRoot(), "src", "cli", "main.ts"),
	).href;
	const script = `const { main } = await import(${JSON.stringify(entry)}); process.exitCode = await main(${JSON.stringify([...args])}, ${JSON.stringify(cwd)});`;
	return runNodeScript({
		nodeArgs: ["--input-type=module", "-e", script],
		cwd,
		timeoutMs: 120000,
		env: {},
	});
}

export function runLauncher(
	repoDir: string,
	words: ReadonlyArray<string>,
	stdin?: string,
): Promise<CliResult> {
	return runNodeScript({
		nodeArgs: [path.join(repoDir, ".codictator", "bin", "run.mjs"), ...words],
		cwd: repoDir,
		timeoutMs: 120000,
		env: {},
		...(stdin === undefined ? {} : { stdin }),
	});
}

// A worktree write that creates parent dirs (unlike raw writeFileSync) and
// leaves staging alone, so git probes control exactly what is staged.
export function writeTreeFile(
	repo: TempRepo,
	relative: string,
	content: string,
): void {
	const full = path.join(repo.dir, relative);
	mkdirSync(path.dirname(full), { recursive: true });
	writeFileSync(full, content, "utf8");
}

export function writePayload(
	repoDir: string,
	file: string,
	content: string,
): Record<string, unknown> {
	return {
		session_id: "sess-consumer-0",
		cwd: repoDir,
		hook_event_name: "PreToolUse",
		tool_name: "Write",
		tool_input: { file_path: path.join(repoDir, file), content },
		tool_use_id: "toolu-0",
	};
}

// An allow is exactly "{}"; anything else carries the harness deny with the
// blocking rule and remediation in the reason.
export function denyReason(stdout: string): string | undefined {
	const text = stdout.trim();
	if (text === "{}" || text === "") {
		return undefined;
	}
	const parsed = parseJson(text);
	if (parsed.ok && typeof parsed.value === "object" && parsed.value !== null) {
		const { hookSpecificOutput: specific } = parsed.value as {
			hookSpecificOutput?: unknown;
		};
		if (typeof specific === "object" && specific !== null) {
			const { permissionDecision, permissionDecisionReason } = specific as {
				permissionDecision?: unknown;
				permissionDecisionReason?: unknown;
			};
			if (permissionDecision === "deny") {
				return String(permissionDecisionReason ?? text);
			}
		}
	}
	return text;
}

export async function taskId(repo: TempRepo, title: string): Promise<string> {
	const created = await srcMain(
		["task", "new", "--type", "feature", "--title", title],
		repo.dir,
	);
	assert.equal(created.code, 0, `task new failed: ${created.stderr}`);
	const match = /created (T-\d+)/.exec(created.stdout);
	assert.ok(match?.[1] !== undefined, `no task id in: ${created.stdout}`);
	return match[1] as string;
}

export async function toPlanning(repo: TempRepo, id: string): Promise<void> {
	const amended = await srcMain(
		[
			"task",
			"amend",
			"--id",
			id,
			"--spec",
			"docs/SPEC/04-12-WORKFLOW.md",
			"--accept",
			"widget renders",
			"--allow",
			"tests/**",
			"--allow",
			"src/**",
			"--test",
			"tests/widget.test.ts::[§4.12] widget::regression",
		],
		repo.dir,
	);
	assert.equal(amended.code, 0, `amend failed: ${amended.stderr}`);
	const next = await srcMain(["task", "phase", "next", "--id", id], repo.dir);
	assert.equal(next.code, 0, `phase next failed: ${next.stdout}${next.stderr}`);
}

// Slice 0 meta-guard table: [ruleId, probe, gap]. Probe keys are executed
// once each; results cached. Lives here (not in the test file) so both
// consumer suites stay under the core/file-size cap that covers tests.
export const MATRIX: ReadonlyArray<readonly [string, string, string]> = [
	["core/mcp-declared", "session", "G3"],
	["core/guardrail-manifest", "session", "G3"],
	["core/hooks-active", "session", "G3"],
	["core/engine-version-match", "session", "G3"],
	["core/workflow-gates", "write-notask", "G1"],
	["core/writes-within-plan", "write-narrow", "G1"],
	["core/red-before-green", "write-preproof", "G1"],
	["core/arch-module-mapped", "write-preproof", "G2"],
	["core/arch-boundaries", "write-preproof", "G2"],
	["core/arch-public-entry", "write-preproof", "G2"],
	["core/arch-no-cycles", "write-preproof", "G2"],
	["core/no-secrets", "write-secret", "G2"],
	["core/write-confinement", "write-outside", "G2"],
	["core/dangerous-shell", "shell-danger", "G2"],
	["core/no-secret-reads", "read-secret", "G2"],
	["core/read-dedupe", "read-twice", "G2"],
	["core/graph-before-scan", "glob-broad", "G2"],
	["core/history-append-only", "write-history-edit", "G2"],
	["core/bug-rows-immutable", "write-bugs-edit", "G2"],
	["core/diagnose-before-fix", "write-fix-nodiag", "G1"],
	["core/dep-exact-pin", "write-package", "G2"],
	["core/dep-one-per-capability", "write-package", "G2"],
	["core/no-guard-removal", "stage-unguarded", "G5"],
	["core/ci-actions-pinned", "write-workflow", "G2"],
	["core/file-naming", "write-badname", "G2"],
	["core/no-bypass", "write-bypass", "G2"],
	["core/conventional-commit", "msg-badsubject", "G5"],
	["core/arch-profile-declared", "stage-planning", "G5"],
	["core/repo-hygiene", "stage-planning", "G5"],
	["core/doc-one-level", "stage-docs", "G5"],
	["core/doc-router-leaf", "stage-docs", "G5"],
	["core/doc-links-valid", "stage-docs", "G5"],
	["core/doc-no-inline-changelog", "stage-docs", "G5"],
	["core/doc-no-corpus-counts", "stage-docs", "G5"],
	["core/doc-single-owner", "stage-docs", "G5"],
	["core/dep-no-vulnerable", "stage-deps", "G5"],
	["core/dep-no-deprecated", "stage-deps", "G5"],
	["core/dep-new-needs-reason", "stage-deps", "G5"],
	["core/dep-lockfile", "stage-deps", "G5"],
	["core/history-entry-complete", "stage-history", "G5"],
	["core/history-entry", "verify-norange-history", "G6"],
	["core/no-assertion-loss", "verify-tdd-range", "G6"],
	["core/no-skipped-tests", "verify-tdd-range", "G6"],
	["core/no-new-suppressions", "verify-tdd-range", "G6"],
	["core/no-fixture-shrink", "verify-tdd-range", "G6"],
	["core/no-threshold-lowering", "verify-tdd-range", "G6"],
	["core/test-command-intact", "verify-tdd-range", "G6"],
	["core/test-kinds-by-scenario", "verify-tdd-range", "G6"],
	["core/regression-test-for-fix", "verify-tdd-range", "G6"],
	["core/no-baseline-raise", "verify-tdd-range", "G6"],
	["core/no-speculative-abstraction", "verify-tdd-range", "G6"],
	["core/review-gate", "verify-tdd-range", "G6"],
	["core/bug-registry", "verify-tdd-range", "G6"],
	["core/compiler-strict", "verify-tdd-range", "G6"],
	["core/perf-budgets", "verify-tdd-range", "G6"],
	["core/branch-protection", "verify-tdd-range", "G6"],
	["core/ci-present", "verify-tdd-range", "G6"],
	["core/ci-required-check", "verify-tdd-range", "G6"],
	["core/waivers-valid", "verify-tdd-range", "G6"],
	["core/custom-pack-selftest", "verify-tdd-range", "G6"],
	["ts/no-phantom-import", "write-ts-phantom", "G2"],
	["ts/security-patterns", "write-ts-eval", "G2"],
	["ts/lint", "verify-tdd-range", "G6"],
	["ts/typecheck", "verify-tdd-range", "G6"],
	["python/no-phantom-import", "write-py-phantom", "G2"],
	["python/security-patterns", "write-py-eval", "G2"],
	["python/lint", "verify-tdd-range", "G6"],
	["python/typecheck", "verify-tdd-range", "G6"],
	["core/spec-trace", "bydesign", "BYDESIGN"],
	["core/dead-code", "bydesign", "BYDESIGN"],
];

// Finding ids from a `--json` CLI reply; empty when the reply is not JSON.
export function findingIds(stdout: string): Array<string> {
	const start = stdout.indexOf("{");
	if (start < 0) {
		return [];
	}
	const parsed = parseJson(stdout.slice(start));
	if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) {
		return [];
	}
	const { findings } = parsed.value as {
		findings?: Array<{ ruleId?: string }>;
	};
	if (!Array.isArray(findings)) {
		return [];
	}
	return findings
		.map((finding) => finding?.ruleId ?? "")
		.filter((id) => id !== "");
}

// Split literal so a committed test source never holds a live-pattern
// literal the repo's own L4 gate would flag (same idiom as l34).
export const VECTOR = ["sk-dogfood-rejected-", "0123456789abcdef"].join("");
