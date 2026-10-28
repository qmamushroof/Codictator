// SPEC §4.13.1: brownfield adoption on the ts-brownfield fixture repo.
// Detection names the loose pin and the missing lockfile, the baseline
// records the current findings as .codictator/baseline.json, and the
// immediate floor remediation pins the range at its lockfile-resolved
// version without changing the version.
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	applyFloorPins,
	captureBaseline,
	detectBrownfield,
} from "../../../src/features/remediation/index.ts";
import { stableStringify } from "../../../src/kernel/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";
import { createTempRepo } from "../../support/temp-repo.ts";

function fixturesRoot(): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(here, "..", "..", "..", "fixtures", "repos");
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

function withLoosePin(files: Record<string, string>): Record<string, string> {
	const manifest: unknown = JSON.parse(files["package.json"] ?? "{}");
	assert.equal(typeof manifest, "object");
	assert.ok(manifest !== null);
	const root = manifest as Record<string, unknown>;
	return {
		...files,
		"package.json": stableStringify({
			...root,
			dependencies: { lodash: "^4.17.21" },
		}),
	};
}

test("[§4.13.1] adoption detects, baselines and floor-pins ts-brownfield", async () => {
	const fixtureDir = path.join(fixturesRoot(), "ts-brownfield");
	assert.equal(statSync(fixtureDir).isDirectory(), true);
	const repo = createTempRepo(withLoosePin(readTree(fixtureDir)));
	try {
		const manifestText = readFileSync(
			path.join(repo.dir, "package.json"),
			"utf8",
		);
		const detected = detectBrownfield({
			files: ["package.json", "src/index.ts", "src/legacy.ts"],
			manifests: [{ path: "package.json", text: manifestText }],
			lockfiles: { "package.json": null },
			now: FIXED_INSTANT,
		});
		assert.equal(detected.bot, "codictator");
		assert.deepEqual(detected.loosePins, [
			{ path: "package.json", name: "lodash", range: "^4.17.21" },
		]);
		assert.deepEqual(detected.missingLockfiles, ["package.json"]);
		assert.ok(
			detected.findings.some(
				(finding) => finding.ruleId === "core/dep-exact-pin",
			),
		);

		const captured = await captureBaseline("repo-root", detected.findings);
		assert.equal(captured.ok, true);
		if (!captured.ok) {
			return;
		}
		assert.ok(
			(captured.value.entries["core/dep-exact-pin@1"]?.["package.json"] ?? 0) >
				0,
		);
		repo.writeFile(
			".codictator/baseline.json",
			`${stableStringify(captured.value)}\n`,
		);
		const recorded: unknown = JSON.parse(
			readFileSync(path.join(repo.dir, ".codictator", "baseline.json"), "utf8"),
		);
		assert.equal((recorded as { version: number }).version, 1);

		const pinned = applyFloorPins(manifestText, { lodash: "4.17.21" });
		assert.equal(pinned.ok, true);
		if (!pinned.ok) {
			return;
		}
		assert.deepEqual(pinned.value.pinned, ["lodash"]);
		assert.ok(pinned.value.text.includes('"lodash": "4.17.21"'));
		repo.writeFile("package.json", pinned.value.text);

		const after = detectBrownfield({
			files: ["package.json", "src/index.ts", "src/legacy.ts"],
			manifests: [{ path: "package.json", text: pinned.value.text }],
			lockfiles: { "package.json": null },
			now: FIXED_INSTANT,
		});
		assert.equal(after.loosePins.length, 0);
		assert.ok(
			after.findings.every(
				(finding) => finding.ruleId !== "core/dep-exact-pin",
			),
		);
	} finally {
		repo.cleanup();
	}
});
