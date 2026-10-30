// SPEC §4.18.3-§4.18.5: branch coverage for the audit surfaces (status,
// replay, CI summary, report) the red ledger does not pin. Pure builders
// over caller-supplied inputs: no ports, no I/O, fully deterministic.
import { strict as assert } from "node:assert";
import test from "node:test";
import type {
	CiSummaryInput,
	EventLogLine,
	StatusInput,
} from "../../../src/features/audit/index.ts";
import {
	buildCiSummary,
	buildReportText,
	buildStatusJson,
	buildStatusText,
	replaySummary,
} from "../../../src/features/audit/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";

function statusInput(overrides: Partial<StatusInput> = {}): StatusInput {
	return {
		engineVersion: "0.0.0",
		packs: {},
		harnesses: [],
		events: 0,
		corrupt: 0,
		gap: false,
		now: FIXED_INSTANT,
		...overrides,
	};
}

function eventLine(overrides: Partial<EventLogLine> = {}): EventLogLine {
	return {
		v: 1,
		id: "evt-1",
		ts: FIXED_INSTANT,
		now: FIXED_INSTANT,
		kind: "verdict",
		layer: "L1",
		trigger: "pre-tool",
		ruleIds: [],
		durationMs: 5,
		configHash: "abc",
		packs: {},
		...overrides,
	};
}

test("[§4.18.3] status text renders every section with values", () => {
	// SPEC §4.18.3: engine, sorted packs, harness states, task, waivers,
	// ratchet, deps, integrity, escalations, remediation and event counts.
	const text = buildStatusText(
		statusInput({
			packs: { typescript: "1.0.0", core: "2.0.0" },
			harnesses: [{ harness: "muse-code", state: "active", layers: "L0:yes" }],
			events: 3,
			corrupt: 1,
			gap: true,
			task: "T-0001",
			waivers: "W-1 (3d left)",
			ratchet: "tightened 2",
			deps: "fresh",
			integrity: "clean",
			escalations: "none open",
			remediation: "1/2",
		}),
	);
	assert.ok(text.includes("codictator 0.0.0 status at"));
	assert.ok(text.includes("packs: core@2.0.0, typescript@1.0.0"));
	assert.ok(text.includes("- muse-code: active (L0:yes)"));
	assert.ok(text.includes("task: T-0001"));
	assert.ok(text.includes("waivers: W-1 (3d left)"));
	assert.ok(text.includes("ratchet: tightened 2"));
	assert.ok(text.includes("deps: fresh"));
	assert.ok(text.includes("integrity: clean"));
	assert.ok(text.includes("escalations: none open"));
	assert.ok(text.includes("remediation: 1/2"));
	assert.ok(text.includes("3 observed, 1 corrupt"));
	assert.ok(text.includes("gap in coverage"));
});

test("[§4.18.3] status text falls back when nothing is observed", () => {
	// SPEC §4.18.3: empty packs, harnesses and optionals render the
	// terse fallbacks instead of blank lines.
	const text = buildStatusText(statusInput());
	assert.ok(text.includes("packs: none configured"));
	assert.ok(text.includes("harnesses:"));
	assert.ok(text.includes("task: none active"));
	assert.ok(text.includes("waivers: none in force"));
	assert.ok(text.includes("ratchet: no baseline history"));
	assert.ok(text.includes("deps: freshness unknown"));
	assert.ok(text.includes("integrity: unverified"));
	assert.ok(text.includes("escalations: none open"));
	assert.ok(text.includes("remediation: no plan"));
	assert.ok(text.includes("0 observed, 0 corrupt"));
	assert.ok(!text.includes("gap in coverage"));
});

test("[§4.18.3] status json mirrors the status input as data", () => {
	// SPEC §4.18.3: --json emits the same screen as data for the
	// extension; absent optionals read null.
	const json = buildStatusJson(
		statusInput({ packs: { core: "2.0.0" }, task: "T-0001" }),
	) as {
		engineVersion: unknown;
		packs: unknown;
		task: unknown;
		waivers: unknown;
		now: unknown;
	};
	assert.equal(json.engineVersion, "0.0.0");
	assert.deepEqual(json.packs, { core: "2.0.0" });
	assert.equal(json.task, "T-0001");
	assert.equal(json.waivers, null);
	assert.equal(json.now, FIXED_INSTANT);
});

test("[§4.18.3] status text names helper presence per required role", () => {
	// SPEC §4.18.3 + §4.6.6: present helpers render with binary and pin;
	// missing roles render missing; no roles reads none declared.
	const text = buildStatusText(
		statusInput({
			helpers: [
				{ role: "knowledge-graph", present: true, detail: "lat 0.13.3" },
				{ role: "token-saver", present: false },
			],
		}),
	);
	assert.ok(
		text.includes(
			"helpers: knowledge-graph present (lat 0.13.3), token-saver missing",
		),
	);
	const bare = buildStatusText(statusInput());
	assert.ok(bare.includes("helpers: none declared"));
});

test("[§4.18.3] status json carries helper presence per required role", () => {
	// SPEC §4.18.3: the extension sees the same helper rows; absent reads null.
	const json = buildStatusJson(
		statusInput({
			helpers: [
				{ role: "knowledge-graph", present: true, detail: "lat 0.13.3" },
			],
		}),
	) as { helpers: unknown };
	assert.deepEqual(json.helpers, [
		{ role: "knowledge-graph", present: true, detail: "lat 0.13.3" },
	]);
	const bare = buildStatusJson(statusInput()) as { helpers: unknown };
	assert.equal(bare.helpers, null);
});

test("[§4.18.2] replay summary names verdict, inputs and rerun", () => {
	// SPEC §4.18.2: a pack list sorts for determinism; an empty pack map
	// reads "none"; a missing decision reads "observed".
	const text = replaySummary(
		eventLine({
			id: "evt-9",
			kind: "verdict",
			layer: "L2",
			decision: "block",
			configHash: "hash-1",
			packs: { b: "2", a: "1" },
		}),
	);
	assert.ok(text.includes("event evt-9: verdict/L2 block"));
	assert.ok(text.includes("packs a@1, b@2"));
	assert.ok(text.includes("rerun: codictator replay evt-9"));
	const bare = replaySummary(eventLine({ packs: {} }));
	assert.ok(bare.includes("packs none"));
	assert.ok(bare.includes("observed"));
});

test("[§4.18.4] ci summary keeps section order under the cap", () => {
	// SPEC §4.18.4: integrity then blocking, exceptions, waivers, deps,
	// remediation, unverifiable; under 60 KB nothing collapses.
	const input: CiSummaryInput = {
		integrity: ["core/guardrail-manifest: drift"],
		blocking: ["core/ci-present: base unreachable"],
		exceptions: ["review by suku"],
		waivers: ["W-1"],
		deps: ["all fresh"],
		remediation: ["1/2 done"],
		unverifiable: ["external CI pending"],
		command: "codictator ci verify",
	};
	const text = buildCiSummary(input);
	const order = [
		"# codictator CI summary",
		"## integrity then blocking findings",
		"core/guardrail-manifest: drift",
		"core/ci-present: base unreachable",
		"## exceptions and review identity",
		"review by suku",
		"## waivers and ratchet movement",
		"## dependencies",
		"## remediation progress",
		"## unverifiable items",
		"external CI pending",
	];
	let cursor = -1;
	for (const marker of order) {
		const at = text.indexOf(marker);
		assert.ok(at > cursor, `out of order: ${marker}`);
		cursor = at;
	}
	assert.ok(!text.includes("truncated with counts"));
});

test("[§4.18.4] ci summary renders empty sections as none", () => {
	// SPEC §4.18.4: sections with no lines still print with "none".
	const text = buildCiSummary({
		integrity: [],
		blocking: [],
		exceptions: [],
		waivers: [],
		deps: [],
		remediation: [],
		unverifiable: [],
		command: "codictator ci verify",
	});
	assert.ok(text.includes("## integrity then blocking findings\nnone"));
	assert.ok(text.includes("## unverifiable items\nnone"));
});

test("[§4.18.5] report metrics read from local events only", () => {
	// SPEC §4.18.5: block/allow pairs set the self-correction rate,
	// escalations count, p95 renders in ms, and token metrics stay
	// "unavailable" without harness usage data.
	const text = buildReportText({
		events: [
			eventLine({ id: "e1", decision: "block", durationMs: 10 }),
			eventLine({ id: "e2", decision: "allow", durationMs: 30 }),
			eventLine({ id: "e3", kind: "escalation", durationMs: 20 }),
		],
		corrupt: 2,
		now: FIXED_INSTANT,
	});
	assert.ok(text.includes("self-correction rate: 1/1"));
	assert.ok(text.includes("loop-breaker escalations: 1"));
	assert.ok(text.includes("unavailable (no harness usage data)"));
	assert.ok(text.includes("p95 event latency: 30ms"));
	assert.ok(text.includes("corrupt lines skipped: 2"));
});

test("[§4.18.5] report with no events names the gaps", () => {
	// SPEC §4.18.5: with no events the rate and p95 name the gap instead
	// of rendering zeros.
	const text = buildReportText({ events: [], corrupt: 0, now: FIXED_INSTANT });
	assert.ok(text.includes("no blocks observed"));
	assert.ok(text.includes("p95 event latency: no events observed"));
});
