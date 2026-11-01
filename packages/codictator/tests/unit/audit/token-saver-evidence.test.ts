// SPEC §4.18.3 + §4.6.3/§4.6.4: the token-saver evidence behind the
// engine-satisfied row. Scoped injection renders an appendable
// kind:"injection" event through the existing event-log path; the budget
// band reads live from the last injection's budget line when usage is
// present and unavailable otherwise (EC-4: never estimated); an empty log
// still reads missing.
import { strict as assert } from "node:assert";
import test from "node:test";
import { appendEvent } from "../../../src/features/audit/append.ts";
import {
	buildInjectionEvent,
	buildStatusText,
	readEvents,
	summarizeTokenSaverEvidence,
	tokenSaverHelper,
} from "../../../src/features/audit/index.ts";
import { renderScopedInjection } from "../../../src/features/steering/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";
import { createFakePorts } from "../../support/fake-ports.ts";

const ROOT = "repo";

function messageBytes(message: string): number {
	return new TextEncoder().encode(message).length;
}

test("[§4.18.3] scoped injection appends a content-digest injection event", async () => {
	// SPEC §4.18.3 + §4.6.3: the rendered injection builds the auditable
	// event (evaluate.ts:322 pattern) and lands through the existing append
	// path; the log line carries the digest-suffixed id and the message
	// byte count the evidence parses back.
	const bundle = createFakePorts();
	const injection = await renderScopedInjection(
		"session-1",
		["src/a.ts"],
		2000,
		{ usedTokens: 1000, contextWindow: 100000 },
	);
	const built = buildInjectionEvent({
		content: injection.content,
		trigger: "startup",
		sessionId: "session-1",
		configHash: "abc",
	});
	assert.equal(built.kind, "injection");
	assert.equal(built.layer, "L0");
	assert.equal(built.message, injection.content);
	const appended = await appendEvent(bundle.ports, ROOT, built);
	assert.equal(appended.ok, true);
	const read = await readEvents(bundle.ports, ROOT);
	assert.equal(read.ok, true);
	if (!read.ok) {
		throw new Error("expected the event log to be readable");
	}
	assert.equal(read.value.events.length, 1);
	const line = read.value.events[0];
	assert.equal(line?.kind, "injection");
	const id = line?.id ?? "";
	const cut = id.lastIndexOf("-");
	assert.ok(cut > 0);
	assert.match(id.slice(cut + 1), /^[0-9a-f]{12}$/);
	assert.equal(line?.message, injection.content);
	assert.equal(messageBytes(line?.message ?? ""), injection.bytes);
	const evidence = summarizeTokenSaverEvidence(read.value.events);
	assert.equal(evidence.injectionHash, id.slice(cut + 1));
	assert.equal(evidence.injectionBytes, injection.bytes);
});

test("[§4.6.4] token-saver budget band is live when usage is present", async () => {
	// SPEC §4.6.4 + §4.18.3: usage at render time (HookEvent.usage against
	// config.steering.contextWindow) names the band on the budget line, so
	// the row reads it live; without usage it reads unavailable, never an
	// estimate (EC-4).
	const live = createFakePorts();
	const used = await renderScopedInjection("session-1", ["src/a.ts"], 2000, {
		usedTokens: 65000,
		contextWindow: 100000,
	});
	assert.ok(used.content.includes("Budget: amber (65000/100000 tokens used)."));
	const liveAppended = await appendEvent(
		live.ports,
		ROOT,
		buildInjectionEvent({
			content: used.content,
			trigger: "startup",
			sessionId: "session-1",
			configHash: "abc",
		}),
	);
	assert.equal(liveAppended.ok, true);
	const liveRead = await readEvents(live.ports, ROOT);
	assert.equal(liveRead.ok, true);
	if (!liveRead.ok) {
		throw new Error("expected the event log to be readable");
	}
	const liveEvidence = summarizeTokenSaverEvidence(liveRead.value.events);
	assert.equal(liveEvidence.budget, "amber");
	const liveHelper = tokenSaverHelper(liveEvidence);
	assert.equal(liveHelper.present, true);
	assert.ok(liveHelper.detail?.includes("engine-satisfied") === true);
	assert.ok(liveHelper.detail?.includes("budget amber") === true);

	const bare = createFakePorts();
	const plain = await renderScopedInjection("session-2", ["src/a.ts"], 2000);
	assert.ok(plain.content.includes("Budget: unavailable (no usage data)."));
	const bareAppended = await appendEvent(
		bare.ports,
		ROOT,
		buildInjectionEvent({
			content: plain.content,
			trigger: "startup",
			sessionId: "session-2",
			configHash: "abc",
		}),
	);
	assert.equal(bareAppended.ok, true);
	const bareRead = await readEvents(bare.ports, ROOT);
	assert.equal(bareRead.ok, true);
	if (!bareRead.ok) {
		throw new Error("expected the event log to be readable");
	}
	const bareEvidence = summarizeTokenSaverEvidence(bareRead.value.events);
	assert.equal(bareEvidence.budget, "unavailable");
	const bareHelper = tokenSaverHelper(bareEvidence);
	assert.equal(bareHelper.present, true);
	assert.ok(bareHelper.detail?.includes("budget unavailable") === true);
});

test("[§4.18.3] token-saver row stays missing on a truly empty log", () => {
	// SPEC §4.18.3 + §4.6.6: all-absent evidence is a finding, not a pass;
	// with no injection, no band and no dedupe blocks the row never claims
	// engine-satisfied.
	const helper = tokenSaverHelper(summarizeTokenSaverEvidence([]));
	assert.equal(helper.role, "token-saver");
	assert.equal(helper.present, false);
	const text = buildStatusText({
		engineVersion: "0.0.0",
		packs: {},
		harnesses: [],
		helpers: [helper],
		events: 0,
		corrupt: 0,
		gap: true,
		now: FIXED_INSTANT,
	});
	assert.ok(text.includes("token-saver missing"));
	assert.ok(!text.includes("engine-satisfied"));
});
