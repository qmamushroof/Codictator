// SPEC §4.15.1 + §4.15.5/§4.15.6: init/regen setup detection for the
// generated workflow. The self-host decision reads the root manifest's
// explicit flag; install, build and Node inputs read lockfile, build
// script and version file presence.
import { strict as assert } from "node:assert";
import test from "node:test";
import { detectWorkflowOptions } from "../../../src/cli/init-plan.ts";
import { guardrailPlan } from "../../../src/cli/plan.ts";
import { createTempRepo } from "../../support/temp-repo.ts";

function workflowText(
	plan: ReturnType<typeof guardrailPlan>,
): string {
	return (
		plan.files.find((file) => file.path === ".github/workflows/codictator.yml")
			?.content ?? ""
	);
}

test("[§4.15.1] setup detection reads the manifest flag lockfile build script and version file", async () => {
	const flagged = createTempRepo({
		".nvmrc": "24\n",
		"package-lock.json": "{}",
		"package.json": JSON.stringify({
			codictator: { selfHost: true },
			name: "app",
			scripts: { build: "tsc" },
		}),
	});
	try {
		assert.deepEqual(await detectWorkflowOptions(flagged.dir), {
			selfHost: true,
		});
	} finally {
		flagged.cleanup();
	}
	const tooled = createTempRepo({
		".nvmrc": "24\n",
		"package-lock.json": "{}",
		"package.json": JSON.stringify({
			name: "app",
			scripts: { build: "tsc" },
		}),
	});
	try {
		assert.deepEqual(await detectWorkflowOptions(tooled.dir), {
			buildCommand: "npm run build",
			nodeVersionFile: ".nvmrc",
		});
	} finally {
		tooled.cleanup();
	}
	const bare = createTempRepo({
		"package.json": JSON.stringify({ name: "app" }),
	});
	try {
		assert.deepEqual(await detectWorkflowOptions(bare.dir), {
			installCommand: "npm install --ignore-scripts",
		});
	} finally {
		bare.cleanup();
	}
});

test("[§4.15.5] guardrail plan renders the source bootstrap only with the self-host flag", () => {
	const consumer = workflowText(
		guardrailPlan(["opencode"], "app", "repo", undefined),
	);
	assert.ok(consumer.includes("npx --no-install codictator ci verify"));
	assert.ok(!consumer.includes("packages/codictator/dist"));
	const selfHost = workflowText(
		guardrailPlan(
			["opencode"],
			"app",
			"repo",
			undefined,
			{},
			undefined,
			undefined,
			{ selfHost: true },
		),
	);
	assert.ok(
		selfHost.includes(
			"node packages/codictator/dist/cli/main.js ci verify",
		),
	);
});
