// SPEC §4.4.5 + §7.2: unit proof for declaration narrowing. Malformed
// config.tools rows and pack bindings fail the load with CDX-E203 or
// CDX-E206, so the runner never sees them.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	narrowExternalArgs,
	narrowToolDecl,
} from "../../../src/features/packs/enforcers/external-bind.ts";

function toolEntry(overrides: Record<string, unknown> = {}): unknown {
	return {
		id: "lint",
		command: ["lint", "{files}"],
		version: { pin: "1.2.3", probe: ["lint", "--version"], pattern: "1.2.3" },
		role: "enforcer",
		timeoutMs: 5000,
		envPass: ["TOKEN"],
		...overrides,
	};
}

test("[§4.4.5] a complete tools entry narrows", () => {
	const narrowed = narrowToolDecl(toolEntry());
	assert.equal(narrowed.ok, true);
});

test("[§4.4.5] a tools entry without a pin fails with CDX-E206", () => {
	const narrowed = narrowToolDecl(
		toolEntry({ version: { probe: ["lint", "--version"], pattern: "1.2.3" } }),
	);
	assert.equal(narrowed.ok, false);
	if (!narrowed.ok) {
		assert.equal(narrowed.error.code, "CDX-E206");
	}
});

test("[§4.4.5] a helper role cannot back an enforcer", () => {
	const narrowed = narrowToolDecl(toolEntry({ role: "knowledge-graph" }));
	assert.equal(narrowed.ok, false);
	if (!narrowed.ok) {
		assert.equal(narrowed.error.code, "CDX-E203");
	}
});

test("[§4.4.5] a tools entry without a command fails with CDX-E203", () => {
	const narrowed = narrowToolDecl(toolEntry({ command: [] }));
	assert.equal(narrowed.ok, false);
	if (!narrowed.ok) {
		assert.equal(narrowed.error.code, "CDX-E203");
	}
});

test("[§4.4.5] an unknown input mode fails with CDX-E203", () => {
	const narrowed = narrowExternalArgs("test/tool", { input: "carrier-pigeon" });
	assert.equal(narrowed.ok, false);
	if (!narrowed.ok) {
		assert.equal(narrowed.error.code, "CDX-E203");
	}
});

test("[§4.4.5] overlapping pass and findings codes fail with CDX-E203", () => {
	const narrowed = narrowExternalArgs("test/tool", {
		exitCodes: { pass: [0], findings: [0, 1] },
	});
	assert.equal(narrowed.ok, false);
	if (!narrowed.ok) {
		assert.equal(narrowed.error.code, "CDX-E203");
	}
});

test("[§4.4.5] json output without a select fails with CDX-E203", () => {
	const narrowed = narrowExternalArgs("test/tool", {
		output: { format: "json", source: "stdout" },
	});
	assert.equal(narrowed.ok, false);
	if (!narrowed.ok) {
		assert.equal(narrowed.error.code, "CDX-E203");
	}
});

test("[§4.4.5] an unsafe regex output pattern fails the load", () => {
	const narrowed = narrowExternalArgs("test/tool", {
		output: { format: "regex", source: "stdout", pattern: "(a+)+" },
	});
	assert.equal(narrowed.ok, false);
	if (!narrowed.ok) {
		assert.equal(narrowed.error.code, "CDX-E902");
	}
});
