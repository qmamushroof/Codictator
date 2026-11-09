// SPEC §4.15.6 + §4.15.1: the generated workflow runs in consumer repos
// off the installed launcher with setup-detected steps; the from-source
// bootstrap stays self-host only (SPEC §4.15.5).
import { strict as assert } from "node:assert";
import test from "node:test";
import { renderWorkflow } from "../../../src/features/ci/index.ts";

test("[§4.15.6] consumer render runs the installed launcher with setup-detected steps", () => {
	// SPEC §4.15.6: external CI runs `npx --no-install codictator ci
	// verify`; the generated workflow resolves the same installed binary
	// instead of the self-host dist path, with no hardcoded build or nvmrc.
	const workflow = renderWorkflow("/repo", { repoName: "app" });
	const text = workflow.text ?? "";
	assert.ok(text.includes("npx --no-install codictator ci verify"));
	assert.ok(!text.includes("packages/codictator/dist"));
	assert.ok(!text.includes("npm run build"));
	assert.ok(!text.includes(".nvmrc"));
});

test("[§4.15.5] self-host render keeps the source bootstrap", () => {
	// SPEC §4.15.5: Codictator's own repo bootstraps the CLI from the local
	// checkout, decided by the self-host flag rather than path guessing.
	const workflow = renderWorkflow("/repo", {
		repoName: "app",
		selfHost: true,
	});
	const text = workflow.text ?? "";
	assert.ok(
		text.includes("node packages/codictator/dist/cli/main.js ci verify"),
	);
	assert.ok(text.includes("npm run build"));
	assert.ok(text.includes("node-version-file: .nvmrc"));
});

test("[§4.15.1] setup-detected build and node version file render", () => {
	// SPEC §4.15.1: the install, build and Node inputs come from setup
	// detection, so a consumer repo renders what its toolchain owns.
	const workflow = renderWorkflow("/repo", {
		repoName: "app",
		installCommand: "npm install --ignore-scripts",
		buildCommand: "npm run build",
		nodeVersionFile: ".nvmrc",
	});
	const text = workflow.text ?? "";
	assert.ok(text.includes("npm install --ignore-scripts"));
	assert.ok(!text.includes("npm ci"));
	assert.ok(text.includes("npm run build"));
	assert.ok(text.includes("node-version-file: .nvmrc"));
});
