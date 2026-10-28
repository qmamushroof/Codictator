// SPEC §4.4.5: unit proof for the sarif, json and regex output parsers.
// Tool output is untrusted: paths outside the repo are dropped and counted
// as escapes, and every shape violation fails the parse (CDX-E207).
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	parseJsonOutput,
	parseRegexOutput,
} from "../../../src/features/packs/enforcers/external-output.ts";
import { parseSarif } from "../../../src/features/packs/enforcers/external-sarif.ts";

const SELECT = {
	results: "items",
	path: "file",
	line: "line",
	rule: "rule",
	message: "message",
};

test("[§4.4.5] sarif parsing keeps in-repo findings", () => {
	const parsed = parseSarif(
		JSON.stringify({
			version: "2.1.0",
			runs: [
				{
					tool: { driver: { rules: [{ id: "L1" }] } },
					results: [
						{
							ruleIndex: 0,
							message: { text: "no" },
							locations: [
								{
									physicalLocation: {
										artifactLocation: { uri: "src/a.ts" },
										region: { startLine: 9 },
									},
								},
							],
						},
					],
				},
			],
		}),
	);
	assert.equal(parsed.ok, true);
	if (!parsed.ok) {
		return;
	}
	assert.deepEqual(parsed.value.findings, [
		{ toolRule: "L1", path: "src/a.ts", line: 9, message: "no" },
	]);
	assert.equal(parsed.value.escapes, 0);
});

test("[§4.4.5] sarif parsing drops outside-repo paths as escapes", () => {
	const parsed = parseSarif(
		JSON.stringify({
			version: "2.1.0",
			runs: [
				{
					tool: { driver: { rules: [] } },
					results: [
						{
							ruleId: "L2",
							message: { text: "no" },
							locations: [
								{
									physicalLocation: {
										artifactLocation: { uri: "/etc/passwd" },
										region: { startLine: 1 },
									},
								},
							],
						},
						{
							ruleId: "L2",
							message: { text: "no" },
							locations: [
								{
									physicalLocation: {
										artifactLocation: { uri: "src/../escape.ts" },
										region: { startLine: 1 },
									},
								},
							],
						},
						{
							ruleId: "L2",
							message: { text: "kept" },
							locations: [
								{
									physicalLocation: {
										artifactLocation: { uri: "file://src/b.ts" },
										region: { startLine: 2 },
									},
								},
							],
						},
					],
				},
			],
		}),
	);
	assert.equal(parsed.ok, true);
	if (!parsed.ok) {
		return;
	}
	assert.equal(parsed.value.findings.length, 1);
	assert.equal(parsed.value.findings[0]?.path, "src/b.ts");
	assert.equal(parsed.value.escapes, 2);
});

test("[§4.4.5] sarif parsing fails closed on a missing runs array", () => {
	const parsed = parseSarif(JSON.stringify({ version: "2.1.0" }));
	assert.equal(parsed.ok, false);
	if (!parsed.ok) {
		assert.equal(parsed.error.code, "CDX-E207");
	}
});

test("[§4.4.5] json parsing selects dotted paths", () => {
	const parsed = parseJsonOutput(
		JSON.stringify({
			items: [
				{ file: "src/a.ts", line: "12", rule: "L3", message: "no" },
				{ file: "src/b.ts", line: 3, rule: "L3", message: "no" },
			],
		}),
		SELECT,
	);
	assert.equal(parsed.ok, true);
	if (!parsed.ok) {
		return;
	}
	assert.deepEqual(parsed.value.findings, [
		{ toolRule: "L3", path: "src/a.ts", line: 12, message: "no" },
		{ toolRule: "L3", path: "src/b.ts", line: 3, message: "no" },
	]);
	assert.equal(parsed.value.escapes, 0);
});

test("[§4.4.5] json parsing fails closed on a non-array results node", () => {
	const parsed = parseJsonOutput(JSON.stringify({ items: {} }), SELECT);
	assert.equal(parsed.ok, false);
	if (!parsed.ok) {
		assert.equal(parsed.error.code, "CDX-E207");
	}
});

test("[§4.4.5] regex parsing reads named groups per line", () => {
	const parsed = parseRegexOutput(
		"src/a.ts:5:L4: forbidden call\nnoise without groups\nsrc/b.ts:6:L4: again\n",
		/(?<path>\S+):(?<line>\d+):(?<rule>\w+): (?<message>.+)/,
	);
	assert.equal(parsed.ok, true);
	if (!parsed.ok) {
		return;
	}
	assert.deepEqual(parsed.value.findings, [
		{ toolRule: "L4", path: "src/a.ts", line: 5, message: "forbidden call" },
		{ toolRule: "L4", path: "src/b.ts", line: 6, message: "again" },
	]);
	assert.equal(parsed.value.escapes, 0);
});
