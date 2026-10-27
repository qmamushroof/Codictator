// Standing deviation (fix-up M3, same as the branch deviation): these
// append-level unit tests pass green and stay unlisted while the Phase 9
// red rows in audit.test.ts (SPEC §4.18 EC-1..7) stay listed until Phase 9
// lands. Covers SPEC §4.18.1 single-appendFile semantics against the fake
// Fs ports: one line-atomic JSON line per event, rotation at the size cap
// keeping the newest five, the truncation marker, corrupt-line skip, and
// log creation when the state dir is missing.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	appendEvent,
	KEEP_ROTATED,
	LOG_REL,
	MAX_LINE_BYTES,
	MAX_LOG_BYTES,
	type NewEvent,
} from "../../../src/features/audit/append.ts";
import { readEvents } from "../../../src/features/audit/read.ts";
import { createFakePorts } from "../../support/fake-ports.ts";

const ROOT = "repo";
const LOG = `${ROOT}/${LOG_REL}`;

function makeEvent(overrides: Partial<NewEvent> = {}): NewEvent {
	return {
		kind: "verdict",
		layer: "L1",
		trigger: "pre-tool",
		ruleIds: ["core/no-secrets"],
		durationMs: 5,
		configHash: "abc",
		packs: {},
		...overrides,
	};
}

function byteLength(text: string): number {
	return new TextEncoder().encode(text).length;
}

async function logText(
	bundle: ReturnType<typeof createFakePorts>,
): Promise<string> {
	const seen = await bundle.fs.readText(LOG);
	assert.equal(seen.ok, true);
	if (!seen.ok) {
		throw new Error("expected the event log to be readable");
	}
	return seen.value;
}

test("[append] single event lands as one line-atomic JSON line", async () => {
	const bundle = createFakePorts();
	const appended = await appendEvent(bundle.ports, ROOT, makeEvent());
	assert.equal(appended.ok, true);
	const text = await logText(bundle);
	assert.equal(text.endsWith("\n"), true);
	assert.equal(text.slice(0, -1).includes("\n"), false);
	assert.ok(byteLength(text) <= MAX_LINE_BYTES);
	const read = await readEvents(bundle.ports, ROOT);
	assert.equal(read.ok, true);
	if (read.ok) {
		assert.equal(read.value.events.length, 1);
		assert.equal(read.value.events[0]?.v, 1);
		assert.equal(read.value.events[0]?.kind, "verdict");
		assert.ok(typeof read.value.events[0]?.id === "string");
	}
});

test("[append] two concurrent appends keep both lines intact", async () => {
	const bundle = createFakePorts();
	const first = appendEvent(
		bundle.ports,
		ROOT,
		makeEvent({ message: "first" }),
	);
	const second = appendEvent(
		bundle.ports,
		ROOT,
		makeEvent({ message: "second" }),
	);
	const outcomes = await Promise.all([first, second]);
	assert.deepEqual(
		outcomes.map((outcome) => outcome.ok),
		[true, true],
	);
	const read = await readEvents(bundle.ports, ROOT);
	assert.equal(read.ok, true);
	if (read.ok) {
		assert.equal(read.value.corrupt, 0);
		assert.equal(read.value.events.length, 2);
	}
	const text = await logText(bundle);
	assert.equal(text.split("\n").filter((line) => line !== "").length, 2);
});

test("[append] missing log and state dir are created on first append", async () => {
	const bundle = createFakePorts();
	const before = await bundle.fs.exists(LOG);
	assert.equal(before.ok, true);
	if (before.ok) {
		assert.equal(before.value, false);
	}
	const appended = await appendEvent(bundle.ports, ROOT, makeEvent());
	assert.equal(appended.ok, true);
	const after = await bundle.fs.exists(LOG);
	assert.equal(after.ok, true);
	if (after.ok) {
		assert.equal(after.value, true);
	}
});

test("[append] oversize message is truncated with a marker before append", async () => {
	const bundle = createFakePorts();
	const appended = await appendEvent(
		bundle.ports,
		ROOT,
		makeEvent({ message: "x".repeat(MAX_LINE_BYTES) }),
	);
	assert.equal(appended.ok, true);
	const text = await logText(bundle);
	assert.ok(byteLength(text) <= MAX_LINE_BYTES);
	assert.match(text, /\[truncated \d+ bytes\]/);
});

test("[append] log past the size cap rotates keeping the newest five", async () => {
	const bundle = createFakePorts();
	bundle.fs.seedText(LOG, "a".repeat(MAX_LOG_BYTES));
	for (let index = 1; index <= KEEP_ROTATED; index += 1) {
		bundle.fs.seedText(
			`${ROOT}/.codictator/state/events.${index}.jsonl`,
			`{"v":1,"n":${index}}\n`,
		);
	}
	const appended = await appendEvent(bundle.ports, ROOT, makeEvent());
	assert.equal(appended.ok, true);
	const oldest = await bundle.fs.exists(
		`${ROOT}/.codictator/state/events.1.jsonl`,
	);
	assert.equal(oldest.ok, true);
	if (oldest.ok) {
		assert.equal(oldest.value, false);
	}
	const newest = await bundle.fs.readText(
		`${ROOT}/.codictator/state/events.${KEEP_ROTATED + 1}.jsonl`,
	);
	assert.equal(newest.ok, true);
	if (newest.ok) {
		assert.equal(newest.value, "a".repeat(MAX_LOG_BYTES));
	}
	const listed = await bundle.fs.list(`${ROOT}/.codictator/state`);
	assert.equal(listed.ok, true);
	if (listed.ok) {
		assert.deepEqual(listed.value, [
			"events.2.jsonl",
			"events.3.jsonl",
			"events.4.jsonl",
			"events.5.jsonl",
			`events.${KEEP_ROTATED + 1}.jsonl`,
			"events.jsonl",
		]);
	}
	const text = await logText(bundle);
	assert.equal(text.split("\n").filter((line) => line !== "").length, 1);
});

test("[append] corrupt lines are counted and skipped", async () => {
	const bundle = createFakePorts();
	const appended = await appendEvent(
		bundle.ports,
		ROOT,
		makeEvent({ message: "kept" }),
	);
	assert.equal(appended.ok, true);
	const polluted = await bundle.fs.append(
		LOG,
		new TextEncoder().encode('not json\n{"v":1,\n'),
	);
	assert.equal(polluted.ok, true);
	const read = await readEvents(bundle.ports, ROOT);
	assert.equal(read.ok, true);
	if (read.ok) {
		assert.equal(read.value.events.length, 1);
		assert.equal(read.value.corrupt, 2);
		assert.equal(read.value.events[0]?.message, "kept");
	}
});
