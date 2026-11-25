// BUG-0119 (SPEC §4.14.1): `codictator regen` writes the harness files its
// manifest lists. In this repo every one of them is committed, so none is left
// as untracked noise.

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

interface ManifestArtifact {
	readonly path: string;
}

function repoRoot(): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(here, "..", "..", "..", "..");
}

test("[§4.14.1] every manifest artifact in this repo is tracked by git", () => {
	const root = repoRoot();
	const manifest = JSON.parse(
		readFileSync(path.join(root, ".codictator", "manifest.json"), "utf8"),
	) as { readonly artifacts: ReadonlyArray<ManifestArtifact> };
	const tracked = new Set(
		execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
			.split("\0")
			.filter((entry) => entry !== ""),
	);
	const untracked = manifest.artifacts
		.map((artifact) => artifact.path)
		.filter((artifactPath) => !tracked.has(artifactPath));
	assert.deepEqual(untracked, []);
});
