// SPEC §10.2: fixture repos build into temporary git repos; SPEC §4.5.7:
// harness payload goldens name their source and version. Each test performs
// its real fixture assertions, then calls the not-yet-implemented contract
// it covers (SPEC §4.19 for the CLI run, SPEC §4.5.3 for payload parsing),
// so every test executes and fails red until its implementation lands.
import { strict as assert } from "node:assert";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCommand } from "../../src/cli/index.ts";
import { parseEvent } from "../../src/features/adapters/index.ts";
import { createTempRepo } from "../support/temp-repo.ts";

function fixturesRoot(): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(here, "..", "..", "fixtures");
}

function readTree(root: string): Record<string, string> {
	const files: Record<string, string> = {};
	const walk = (dir: string, prefix: string): void => {
		const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
			a.name < b.name ? -1 : 1,
		);
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
			if (entry.isDirectory()) {
				walk(full, relative);
			} else if (entry.isFile()) {
				files[relative] = readFileSync(full, "utf8");
			}
		}
	};
	walk(root, "");
	return files;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

interface GoldenEnvelope {
	readonly source: unknown;
	readonly version: unknown;
	readonly payload: unknown;
}

function isEnvelope(value: unknown): value is GoldenEnvelope {
	return (
		typeof value === "object" &&
		value !== null &&
		"source" in value &&
		"version" in value &&
		"payload" in value
	);
}

const repoNames = [
	"dotnet",
	"mixed",
	"python",
	"ts-brownfield",
	"ts-clean",
] as const;

for (const name of repoNames) {
	test(`[§10.2] fixture repo ${name} builds into temp git repo`, async () => {
		const dir = path.join(fixturesRoot(), "repos", name);
		assert.equal(statSync(dir).isDirectory(), true);
		const files = readTree(dir);
		assert.ok(Object.keys(files).length > 0);
		const repo = createTempRepo(files);
		try {
			for (const relative of Object.keys(files).sort()) {
				assert.equal(existsSync(path.join(repo.dir, relative)), true);
			}
			assert.equal(repo.git(["status", "--porcelain"]).trim(), "");
			const head = repo.git(["rev-parse", "HEAD"]).trim();
			assert.match(head, /^[0-9a-f]{40}$/);
			await runCommand({ argv: ["verify"], cwd: repo.dir });
		} finally {
			repo.cleanup();
		}
	});
}

interface GoldenCase {
	readonly harness: string;
	readonly version: string;
	readonly file: string;
	readonly event: string;
}

const goldenCases: ReadonlyArray<GoldenCase> = [
	{
		harness: "claude-code",
		version: "0.0.0",
		file: "pre-tool-use.json",
		event: "tool.pre.write",
	},
	{
		harness: "codex-cli",
		version: "0.0.0",
		file: "pre-tool-use.json",
		event: "tool.pre.write",
	},
	{
		harness: "copilot",
		version: "0.0.0",
		file: "pre-tool-use.json",
		event: "tool.pre.write",
	},
	{
		harness: "cursor",
		version: "0.0.0",
		file: "pre-tool-use.json",
		event: "tool.pre.write",
	},
	{
		harness: "gemini-cli",
		version: "0.0.0",
		file: "before-tool.json",
		event: "tool.pre.write",
	},
	{
		harness: "muse-code",
		version: "1.4.10",
		file: "pre-tool-use.json",
		event: "tool.pre.write",
	},
	{
		harness: "opencode",
		version: "1.19.4",
		file: "tool-execute-before.json",
		event: "tool.pre.write",
	},
];

for (const golden of goldenCases) {
	test(`[§4.5.7] golden ${golden.harness}@${golden.version} names source and version`, () => {
		const payloadPath = path.join(
			fixturesRoot(),
			"harness",
			golden.harness,
			golden.version,
			golden.file,
		);
		assert.equal(existsSync(payloadPath), true);
		const raw: unknown = JSON.parse(readFileSync(payloadPath, "utf8"));
		assert.equal(isEnvelope(raw), true);
		if (!isEnvelope(raw)) {
			return;
		}
		assert.equal(raw.source, golden.harness);
		assert.equal(raw.version, golden.version);
		assert.equal(isRecord(raw.payload), true);
		parseEvent(golden.harness, golden.event, raw.payload);
	});
}
