// SPEC §4.5 + §4.6.7 EC-4: hook usage producers. The transcript parser
// reads the last main-chain assistant turn (sidechain turns belong to
// their own session); native usage passes through; harnesses without
// usage report harness-no-usage instead of an estimate.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	budgetForSession,
	currentBand,
	parseTranscriptUsage,
	resolveHookUsage,
	transcriptUsedTokens,
} from "../../../src/features/steering/index.ts";

function transcriptLine(value: unknown): string {
	return `${JSON.stringify(value)}\n`;
}

const TRANSCRIPT = [
	transcriptLine({ type: "user", message: { role: "user", content: "hi" } }),
	transcriptLine({
		type: "assistant",
		message: {
			role: "assistant",
			content: [],
			usage: {
				input_tokens: 1000,
				cache_creation_input_tokens: 50,
				cache_read_input_tokens: 200,
				output_tokens: 30,
			},
		},
	}),
	transcriptLine({
		type: "assistant",
		isSidechain: true,
		message: {
			role: "assistant",
			content: [],
			usage: {
				input_tokens: 99999,
				cache_creation_input_tokens: 1,
				cache_read_input_tokens: 1,
				output_tokens: 1,
			},
		},
	}),
	"not json\n",
	transcriptLine({
		type: "assistant",
		message: {
			role: "assistant",
			content: [],
			usage: {
				input_tokens: 3000,
				cache_creation_input_tokens: 100,
				cache_read_input_tokens: 400,
				output_tokens: 60,
			},
		},
	}),
].join("");

test("[§4.5] transcript usage reads the last main-chain assistant turn", () => {
	// SPEC §4.5: context = last main-chain assistant turn's input +
	// cache-read + cache-creation tokens; the sidechain turn and the
	// corrupt line never count.
	const parsed = parseTranscriptUsage(TRANSCRIPT);
	assert.ok(parsed !== undefined);
	assert.equal(parsed.inputTokens, 3000);
	assert.equal(parsed.cacheReadTokens, 400);
	assert.equal(parsed.cacheCreationTokens, 100);
	assert.equal(transcriptUsedTokens(parsed), 3500);
});

test("[§4.5] transcript usage is undefined without an assistant turn", () => {
	assert.equal(
		parseTranscriptUsage(
			`${transcriptLine({ type: "user", message: { role: "user" } })}\nnot json\n`,
		),
		undefined,
	);
});

test("[§4.5] hook usage resolves per usageData kind", () => {
	// SPEC §4.5: transcript harnesses parse the transcript, native
	// harnesses pass usageData through, and none yields nothing.
	const fromTranscript = resolveHookUsage({
		usageData: "transcript",
		transcriptText: TRANSCRIPT,
	});
	assert.ok(fromTranscript !== undefined);
	assert.equal(fromTranscript.contextTokens, 3500);
	const native = resolveHookUsage({
		usageData: "native",
		nativeUsage: { contextTokens: 120, contextWindow: 1000 },
	});
	assert.ok(native !== undefined);
	assert.equal(native.contextTokens, 120);
	assert.equal(native.contextWindow, 1000);
	assert.equal(
		resolveHookUsage({ usageData: "none", transcriptText: TRANSCRIPT }),
		undefined,
	);
	assert.equal(resolveHookUsage({ usageData: "transcript" }), undefined);
});

function usageEvent(
	id: string,
	sessionId: string,
	harness: string,
	usage: { contextTokens: number; contextWindow: number } | undefined,
): {
	id: string;
	sessionId: string;
	harness: string;
	usage: { contextTokens: number; contextWindow: number } | undefined;
} {
	return { id, sessionId, harness, usage };
}

test("[§4.6] session band evaluates the latest usage event", async () => {
	// SPEC §4.6.4: the band threads recorded usage only; 3500/10000 is
	// green, 6500/10000 is amber, 8000/10000 is red.
	const green = await currentBand("s-green", {
		configuredWindow: 10000,
		events: [
			usageEvent("e1", "s-green", "claude-code", {
				contextTokens: 3500,
				contextWindow: 10000,
			}),
		],
	});
	assert.equal(green.available, true);
	assert.equal(green.band, "green");
	assert.equal(green.usedTokens, 3500);
	const amber = await currentBand("s-amber", {
		configuredWindow: 10000,
		events: [
			usageEvent("e1", "s-amber", "claude-code", {
				contextTokens: 6500,
				contextWindow: 10000,
			}),
		],
	});
	assert.equal(amber.available, true);
	assert.equal(amber.band, "amber");
	const red = await currentBand("s-red", {
		events: [
			usageEvent("e1", "s-red", "other", {
				contextTokens: 8000,
				contextWindow: 10000,
			}),
		],
	});
	assert.equal(red.available, true);
	assert.equal(red.band, "red");
	assert.equal(red.contextWindow, 10000);
});

test("[§4.6] session band prefers the payload window over config", async () => {
	// SPEC §4.6.7 EC-4: the live usage window wins; the configured
	// steering window applies only when the payload names none.
	const live = await currentBand("s-live", {
		configuredWindow: 100000,
		events: [
			usageEvent("e1", "s-live", "claude-code", {
				contextTokens: 650,
				contextWindow: 1000,
			}),
		],
	});
	assert.equal(live.available, true);
	assert.equal(live.band, "amber");
	assert.equal(
		(
			await currentBand("s-configured", {
				configuredWindow: 10000,
				events: [
					usageEvent("e1", "s-configured", "claude-code", {
						contextTokens: 500,
						contextWindow: 0,
					}),
				],
			})
		).band,
		"green",
	);
});

test("[§4.6] session band without usage is unavailable, never estimated", async () => {
	// SPEC §4.6.7 EC-4: no events for the session reads no-session; events
	// without usage on a no-usage harness read harness-no-usage with the
	// harness name. Neither path estimates.
	const missing = await currentBand("s-absent", { events: [] });
	assert.equal(missing.available, false);
	assert.equal(missing.reason, "no-session");
	const noUsage = await currentBand("s-muse", {
		events: [usageEvent("e1", "s-muse", "muse-code", undefined)],
	});
	assert.equal(noUsage.available, false);
	assert.equal(noUsage.reason, "harness-no-usage");
	assert.equal(noUsage.harness, "muse-code");
	assert.equal(budgetForSession([], "s-absent").available, false);
});
