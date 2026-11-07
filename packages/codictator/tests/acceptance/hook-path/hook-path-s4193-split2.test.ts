import { strict as assert } from "node:assert";

import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";

import path from "node:path";

import test from "node:test";

import { fileURLToPath, pathToFileURL } from "node:url";

import { runNodeScript } from "../../support/cli-runner.ts";

import { createTempRepo, type TempRepo } from "../../support/temp-repo.ts";

function packageRoot(): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(here, "..", "..", "..");
}

function workspaceRoot(): string {
	return path.resolve(packageRoot(), "..", "..");
}

function launcherSource(): string {
	return readFileSync(
		path.join(workspaceRoot(), ".codictator", "bin", "run.mjs"),
		"utf8",
	);
}

function goldenPayload(harness: string, version: string, file: string): string {
	return readFileSync(
		path.join(packageRoot(), "fixtures", "harness", harness, version, file),
		"utf8",
	);
}

// The temp repo holds the real launcher at its SPEC path plus an engine
// shim at the SPEC resolution path; the shim re-exports src/cli/main via a
// canonical file URL, so no build is needed and the launcher resolves
// exactly like production. A relative shim specifier breaks when the temp
// repo lives under a symlinked or drive-aliased path (macOS /var to
// /private/var, Windows SUBST drives): realpath adds a level the ../
// arithmetic cannot see, so the engine fails to load.
function installHookPath(
	repo: TempRepo,
	options: { readonly config: boolean; readonly engine: boolean },
): void {
	repo.writeFile(".codictator/bin/run.mjs", launcherSource());
	if (options.engine) {
		const shimDir = path.join(
			repo.dir,
			"node_modules",
			"codictator",
			"dist",
			"cli",
		);
		mkdirSync(shimDir, { recursive: true });
		const target = path.join(packageRoot(), "src", "cli", "main.ts");
		const fileUrl = pathToFileURL(realpathSync(target)).href;
		writeFileSync(
			path.join(shimDir, "main.js"),
			`export { main } from "${fileUrl}";\n`,
			"utf8",
		);
	}
	if (options.config) {
		repo.writeFile(
			".codictator/config.json",
			JSON.stringify({
				version: 1,
				codictator: "unknown",
				packs: [],
				harnesses: ["muse-code", "opencode"],
			}),
		);
	}
	repo.commit("hook path fixture");
}

interface HookResult {
	readonly status: number;
	readonly stdout: string;
	readonly stderr: string;
}

async function runHook(
	repo: TempRepo,
	harness: string,
	event: string,
	payload: unknown,
	cwd: string,
): Promise<HookResult> {
	const child = await runNodeScript({
		nodeArgs: [
			path.join(repo.dir, ".codictator", "bin", "run.mjs"),
			"hook",
			harness,
			event,
		],
		cwd,
		stdin: typeof payload === "string" ? payload : JSON.stringify(payload),
		timeoutMs: 60000,
	});
	return {
		status: child.code,
		stdout: child.stdout,
		stderr: child.stderr,
	};
}

function readPayload(
	harness: string,
	version: string,
	file: string,
	cwd: string,
): Record<string, unknown> {
	const envelope: unknown = JSON.parse(goldenPayload(harness, version, file));
	if (
		typeof envelope !== "object" ||
		envelope === null ||
		!("payload" in envelope)
	) {
		throw new Error("golden envelope is not an object");
	}
	const payload = envelope.payload;
	if (typeof payload !== "object" || payload === null) {
		throw new Error("golden payload is not an object");
	}
	return relocateGoldenPaths({ ...payload, cwd }, cwd) as Record<
		string,
		unknown
	>;
}

// The golden fixtures were captured against /repo while the temp repo
// lives elsewhere. Real harnesses send in-repo tool paths, so relocate
// the golden absolute tool paths under the temp cwd: now that L1 enforces
// write confinement on the write target, an outside-root path must block
// instead of allowing.
function relocateGoldenPaths(value: unknown, cwd: string): unknown {
	if (Array.isArray(value)) {
		return value.map((entry) => relocateGoldenPaths(entry, cwd));
	}
	if (typeof value === "object" && value !== null) {
		const out: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value)) {
			if (
				(key === "file_path" ||
					key === "filePath" ||
					key === "path" ||
					key === "file" ||
					key === "filename") &&
				typeof entry === "string" &&
				entry.startsWith("/repo/")
			) {
				out[key] = path.join(cwd, entry.slice("/repo/".length));
			} else {
				out[key] = relocateGoldenPaths(entry, cwd);
			}
		}
		return out;
	}
	return value;
}

test("[§4.19.3] hook path blocks an OpenCode payload missing the tool", async () => {
	// A bridge payload without tool data fails closed with CDX-E303 on the
	// same wire.
	const repo = createTempRepo();
	try {
		installHookPath(repo, { config: true, engine: true });
		const payload = readPayload(
			"opencode",
			"1.19.4",
			"tool-execute-before.json",
			repo.dir,
		);
		const { tool: _dropped, ...withoutTool } = payload;
		const result = await runHook(
			repo,
			"opencode",
			"tool.execute.before",
			withoutTool,
			repo.dir,
		);
		assert.equal(
			result.status,
			0,
			`stderr: ${result.stderr} stdout-len: ${result.stdout.length}`,
		);
		const reply: unknown = JSON.parse(result.stdout);
		if (
			typeof reply !== "object" ||
			reply === null ||
			!("decision" in reply) ||
			!("message" in reply)
		) {
			throw new Error("reply is not an object");
		}
		assert.equal(
			reply.decision,
			"block",
			`stderr: ${result.stderr} stdout-len: ${result.stdout.length}`,
		);
		assert.match(
			String(reply.message ?? ""),
			/CDX-E303/,
			`stderr: ${result.stderr} stdout-len: ${result.stdout.length}`,
		);
	} finally {
		repo.cleanup();
	}
});

test("[§4.19.3] hook path without an engine answers the static CDX-E003 block", async () => {
	// A fresh clone without npm ci: the launcher answers from its embedded
	// static replies, exit 0 with the harness deny form (§4.5 EC-9 leg).
	const repo = createTempRepo();
	try {
		installHookPath(repo, { config: true, engine: false });
		const result = await runHook(
			repo,
			"muse-code",
			"PreToolUse",
			readPayload("muse-code", "1.4.10", "pre-tool-use.json", repo.dir),
			repo.dir,
		);
		assert.equal(
			result.status,
			0,
			`stderr: ${result.stderr} stdout-len: ${result.stdout.length}`,
		);
		assert.match(
			result.stdout,
			/CDX-E003/,
			`stderr: ${result.stderr} stdout-len: ${result.stdout.length}`,
		);
		assert.match(
			result.stdout,
			/deny/,
			`stderr: ${result.stderr} stdout-len: ${result.stdout.length}`,
		);
	} finally {
		repo.cleanup();
	}
});
