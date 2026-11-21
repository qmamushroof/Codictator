import { strict as assert } from "node:assert";

import test from "node:test";

import type { TaskRecord } from "../../../src/features/workflow/index.ts";

import {
	checkPhaseGate,
	classifyChange,
} from "../../../src/features/workflow/index.ts";

import { FIXED_INSTANT } from "../../support/fake-clock.ts";

const LISTED = [
	"AGENTS.md",
	"CLAUDE.md",
	".claude/settings.json",
	".opencode/plugin.js",
	"opencode.json",
];

function choreFor(allow: ReadonlyArray<string>): TaskRecord {
	return {
		version: 1,
		id: "T-0001",
		type: "chore",
		title: "regen the harness",
		branch: "chore/regen",
		phase: "planning",
		phases: [
			{ name: "planning", enteredAt: FIXED_INSTANT, evidence: "spec refs" },
		],
		spec: [],
		acceptanceCriteria: ["regen output committed"],
		files: { allow },
	};
}

test("[§4.14.1] a path the manifest lists is manifest-owned, an unlisted one is not (BUG-0116)", () => {
	assert.equal(classifyChange(["AGENTS.md"], LISTED), "chore");
	assert.equal(classifyChange([".claude/settings.json"], LISTED), "chore");
	assert.equal(
		classifyChange(["opencode.json", "package.json"], LISTED),
		"chore",
	);
	assert.equal(classifyChange([".claude/other.json"], LISTED), "code");
	assert.equal(classifyChange(["src/a.ts"], LISTED), "code");
	assert.equal(classifyChange(["src/a.ts", "AGENTS.md"], LISTED), "code");
});

test("[§4.14.1] a plan glob counts only with a literal prefix over a listed path (BUG-0116)", () => {
	assert.equal(classifyChange([".claude/**"], LISTED), "chore");
	assert.equal(classifyChange([".opencode/*.js"], LISTED), "chore");
	assert.equal(classifyChange(["src/**"], LISTED), "code");
	assert.equal(classifyChange(["**"], LISTED), "code");
	assert.equal(classifyChange(["*.json"], LISTED), "code");
});

test("[§4.14.1] with no manifest paths only the fixed manifest-owned set counts (BUG-0116)", () => {
	assert.equal(classifyChange([".claude/settings.json"]), "code");
	assert.equal(classifyChange([".claude/settings.json"], []), "code");
	assert.equal(classifyChange(["package.json", ".husky/pre-commit"]), "chore");
});

test("[§4.12.2] a chore planning only manifest-listed files owes nothing before record (BUG-0116)", async () => {
	const findings = await checkPhaseGate(
		choreFor(["AGENTS.md", ".claude/**"]),
		"implementation",
		{ manifestPaths: LISTED },
	);
	assert.deepEqual(findings, []);
});

test("[§4.12.2] a chore planning a file the manifest does not list still owes every gate (BUG-0116)", async () => {
	const findings = await checkPhaseGate(
		choreFor(["AGENTS.md", "src/**"]),
		"implementation",
		{ manifestPaths: LISTED },
	);
	assert.ok(
		findings.some(
			(finding) =>
				finding.code === "CDX-E604" &&
				finding.message.includes("declared tests") &&
				finding.message.includes("red proof"),
		),
	);
});
