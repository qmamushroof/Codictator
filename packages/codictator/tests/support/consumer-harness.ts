// Shared consumer-repo harness for the Slice 0 conformance suite. Builds a
// temp repo with exactly what `codictator init` writes (real writers) and
// drives the real launcher/CLI entries in child processes. No source greps.
// The Slice 0 meta-guard table and finding extraction live apart in
// consumer-matrix.ts so every consumer file stays under the core/file-size
// cap that covers tests.
import { strict as assert } from "node:assert";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadFloorRules } from "../../src/cli/packs.ts";
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

// SPEC §4.6.2 item 3 (G4): the consumer AGENTS.md lists every tier:floor
// rule of the loaded packs. The consumer config carries no packs, so this
// is the core pack's floor set — the same call the real init plan assembly
// makes (buildGuardrailPlan with default flags).
async function consumerAgentsBlock(repoDir: string): Promise<string> {
	const floorRules = await loadFloorRules(repoDir, []);
	return floorRules === undefined
		? buildManagedBlock()
		: buildManagedBlock({ floorRules });
}

// Exactly what `codictator init` writes (real writers) plus the engine shim
// at the launcher's SPEC resolution path, so the installed launcher drives
// the current engine with no build. The AGENTS.md comes from the same
// loader and renderer the real init plan assembly uses (buildGuardrailPlan
// with the consumer's configured packs): loadFloorRules over the registry,
// rendered by buildManagedBlock. The default block is the fallback when
// the registry cannot load, mirroring plan.ts.
export async function installConsumer(repo: TempRepo): Promise<void> {
	repo.writeFile(
		".codictator/config.json",
		JSON.stringify({
			version: 1,
			codictator: "unknown",
			packs: [{ id: "typescript" }, { id: "python" }],
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
	repo.writeFile("AGENTS.md", await consumerAgentsBlock(repo.dir));
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
