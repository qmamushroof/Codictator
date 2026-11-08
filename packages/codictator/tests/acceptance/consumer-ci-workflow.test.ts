// SPEC §4.15.6 + §4.15.5: the generated workflow in a fresh repo runs the
// installed launcher with setup-detected steps; the self-host repo keeps
// the source bootstrap. Drives plan assembly and the plan write, so the
// init/regen path is covered end to end, not only the renderer.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { InitFlags } from "../../src/cli/init-plan.ts";
import { buildGuardrailPlan } from "../../src/cli/init-plan.ts";
import { writePlan } from "../../src/cli/plan.ts";
import { createTempRepo } from "../support/temp-repo.ts";

const FLAGS: InitFlags = {
	harnesses: ["opencode"],
	profile: "",
	packs: [],
	tools: [],
	repair: false,
};

function workflowOf(dir: string): string {
	return readFileSync(`${dir}/.github/workflows/codictator.yml`, "utf8");
}

test("[§4.15.6] generated workflow in a fresh consumer repo runs the installed launcher", async () => {
	// A repo with no build script, no lockfile and no version file gets the
	// installed binary and the install fallback, with no source path, no
	// build step and no version file.
	const repo = createTempRepo({
		"package.json": JSON.stringify({ name: "app" }),
	});
	try {
		const plan = await buildGuardrailPlan(
			repo.dir,
			FLAGS,
			["opencode"],
			"0.0.0",
		);
		const wrote = await writePlan(repo.dir, plan, "0.0.0");
		assert.ok(wrote.ok);
		const text = workflowOf(repo.dir);
		assert.ok(text.includes("npx --no-install codictator ci verify"));
		assert.ok(text.includes("npm install --ignore-scripts"));
		assert.ok(!text.includes("packages/codictator/dist"));
		assert.ok(!text.includes("npm run build"));
		assert.ok(!text.includes("node-version-file"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.15.5] generated workflow in the self-host repo bootstraps from source", async () => {
	// The explicit manifest flag selects the source bootstrap with the
	// detected build and version file.
	const repo = createTempRepo({
		".nvmrc": "24\n",
		"package-lock.json": "{}",
		"package.json": JSON.stringify({
			codictator: { selfHost: true },
			name: "app",
			scripts: { build: "tsc" },
		}),
	});
	try {
		const plan = await buildGuardrailPlan(
			repo.dir,
			FLAGS,
			["opencode"],
			"0.0.0",
		);
		const wrote = await writePlan(repo.dir, plan, "0.0.0");
		assert.ok(wrote.ok);
		const text = workflowOf(repo.dir);
		assert.ok(
			text.includes("node packages/codictator/dist/cli/main.js ci verify"),
		);
		assert.ok(text.includes("npm run build"));
		assert.ok(text.includes("node-version-file: .nvmrc"));
	} finally {
		repo.cleanup();
	}
});
