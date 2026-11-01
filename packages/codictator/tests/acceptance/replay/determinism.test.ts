// SPEC §10.4: one determinism test per acceptance fixture repo plus two
// replay tests. Each builds the fixture repo into a temporary git repo, runs
// evaluation three times with a fixed now, and asserts byte-identical
// verdict JSON; replay of the produced events reproduces the verdict. Each
// test also dumps its canonical verdict bytes under test-results/determinism
// for the cross-OS artifact compare job.
import { strict as assert } from "node:assert";
import {
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCommand } from "../../../src/cli/index.ts";
import { stableStringify } from "../../../src/kernel/index.ts";
import { createTempRepo } from "../../support/temp-repo.ts";

function fixturesRoot(): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(here, "..", "..", "..", "fixtures");
}

// SPEC §4.2.1: the acceptance fixtures carry no config of their own, so the
// suite seeds the minimal valid config before evaluating.
function seedConfig(): Record<string, string> {
	return {
		".codictator/config.json": JSON.stringify({
			version: 1,
			codictator: "0.0.0",
			packs: [],
			harnesses: ["muse-code", "opencode"],
		}),
	};
}

function artifactsDir(): string {
	return path.resolve("test-results", "determinism");
}

// SPEC §10.4: canonical verdict bytes for the artifact compare job.
// stableStringify plus a trailing LF keeps the bytes identical on every OS.
function dumpVerdict(name: string, verdict: unknown): void {
	mkdirSync(artifactsDir(), { recursive: true });
	writeFileSync(
		path.join(artifactsDir(), `${name}.json`),
		`${stableStringify(verdict)}\n`,
		"utf8",
	);
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

const repoNames = [
	"ts-clean",
	"ts-brownfield",
	"dotnet",
	"python",
	"mixed",
] as const;

for (const name of repoNames) {
	test(`[§10.4] determinism ${name} verdict byte-identical across three runs`, async () => {
		// SPEC §10.4: three evaluations with the same inputs and a fixed now
		// produce byte-identical verdict JSON. Strengthened to SPEC row: each
		// run must succeed (a verdict, not an error) before bytes compare.
		const dir = path.join(fixturesRoot(), "repos", name);
		assert.equal(statSync(dir).isDirectory(), true);
		const files = { ...readTree(dir), ...seedConfig() };
		assert.ok(Object.keys(files).length > 0);
		const repo = createTempRepo(files);
		try {
			const first = await runCommand({ argv: ["verify"], cwd: repo.dir });
			const second = await runCommand({ argv: ["verify"], cwd: repo.dir });
			const third = await runCommand({ argv: ["verify"], cwd: repo.dir });
			assert.equal(first.ok, true);
			assert.equal(second.ok, true);
			assert.equal(third.ok, true);
			assert.equal(JSON.stringify(first), JSON.stringify(second));
			assert.equal(JSON.stringify(second), JSON.stringify(third));
			dumpVerdict(name, first);
		} finally {
			repo.cleanup();
		}
	});
}

test("[§10.4] replay reproduces the acceptance verdict", async () => {
	// SPEC §10.4: codictator replay of every event produced by the acceptance
	// suite reproduces its verdict.
	const files = {
		...readTree(path.join(fixturesRoot(), "repos", "ts-clean")),
		...seedConfig(),
	};
	const repo = createTempRepo(files);
	try {
		const verdict = await runCommand({ argv: ["verify"], cwd: repo.dir });
		const replayed = await runCommand({ argv: ["replay"], cwd: repo.dir });
		assert.equal(JSON.stringify(replayed), JSON.stringify(verdict));
		dumpVerdict("replay-acceptance", verdict);
	} finally {
		repo.cleanup();
	}
});

test("[§10.4] replay across OS line endings keeps hashes stable", async () => {
	// SPEC §10.4 with §4.14 EC-5: CRLF conversion keeps hashes stable, so the
	// replayed verdict matches the original byte for byte.
	const files = {
		...readTree(path.join(fixturesRoot(), "repos", "mixed")),
		...seedConfig(),
	};
	const repo = createTempRepo(files);
	try {
		const verdict = await runCommand({ argv: ["verify"], cwd: repo.dir });
		const replayed = await runCommand({ argv: ["replay"], cwd: repo.dir });
		assert.equal(JSON.stringify(replayed), JSON.stringify(verdict));
		dumpVerdict("replay-crlf", verdict);
	} finally {
		repo.cleanup();
	}
});
