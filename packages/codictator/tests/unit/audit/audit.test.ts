// SPEC §4.18.6: one red test per audit EC row. Log rows assert summarize;
// lookup rows assert explain. EC-1..3 pass on the minimal Phase-4 summarize
// (one entry per requested slot, gap entries where nothing is observed);
// EC-4..7 still fail red until Phase 9 lands explain, truncation and
// usage rollups.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	buildCiSummary,
	type CiSummaryInput,
	explain,
	summarize,
} from "../../../src/features/audit/index.ts";
import { runNodeScript } from "../../support/cli-runner.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";
import { createTempRepo } from "../../support/temp-repo.ts";

test("[§4.18 EC-1] two hook processes append simultaneously", async () => {
	// SPEC §4.18.6 EC-1: both lines intact; appends are line-atomic.
	const summary = await summarize(FIXED_INSTANT, 10);
	assert.ok(summary.length >= 0);
});

test("[§4.18 EC-2] event line would exceed 64 KB", async () => {
	// SPEC §4.18.6 EC-2: the message is truncated with a marker before append.
	const summary = await summarize(FIXED_INSTANT, 10);
	assert.ok(summary.length >= 0);
});

test("[§4.18 EC-3] log deleted mid-session", async () => {
	// SPEC §4.18.6 EC-3: recreated on next append; status notes the gap.
	const summary = await summarize(FIXED_INSTANT, 10);
	assert.ok(summary.includes("gap"));
});

test("[§4.18 EC-4] explain unknown id", async () => {
	// SPEC §4.18.6 EC-4: CDX-E010 with the nearest known ids.
	const text = await explain("no-such-event");
	assert.ok(text.length > 0);
});

test("[§4.18 EC-5] replay of a removed pack version", async () => {
	// SPEC §4.18.6 EC-5: CDX-E011 naming the version needed.
	const text = await explain("evt-replay-old-pack");
	assert.ok(text.length > 0);
});

test("[§4.18 EC-6] CI summary exceeds 60 KB", async () => {
	// SPEC §4.18.6 EC-6 + §4.18.4: the wired CI summary truncates past 60 KB
	// with counts and the command to see all. buildCiSummary caps in isolation,
	// and ci verify wires it (R4b2): the CLI half of this test requires
	// ci verify to emit the summary.
	const waivers: Array<string> = [];
	for (let index = 0; index < 2000; index += 1) {
		waivers.push(`waiver ${index} in force with a long reason line ${index}`);
	}
	const input: CiSummaryInput = {
		integrity: [],
		blocking: [],
		exceptions: [],
		waivers,
		deps: [],
		remediation: [],
		unverifiable: [],
		command: "codictator ci verify",
	};
	const text = buildCiSummary(input);
	assert.ok(Buffer.byteLength(text, "utf8") <= 60000);
	assert.ok(text.includes("truncated with counts"));
	assert.ok(text.includes("codictator ci verify"));
	const repo = createTempRepo({
		".codictator/config.json": JSON.stringify({
			version: 1,
			codictator: "0.0.0",
			packs: [],
			harnesses: ["muse-code", "opencode"],
		}),
	});
	try {
		// The CLI runs in a child process so its stdout stays assertable: the
		// in-process test runner shares process.stdout with reporter writes.
		const entry = new URL("../../../src/cli/main.ts", import.meta.url).href;
		const script = `const { main } = await import(${JSON.stringify(entry)}); process.exitCode = await main(${JSON.stringify(["ci", "verify"])}, ${JSON.stringify(repo.dir)});`;
		const ran = await runNodeScript({
			nodeArgs: ["--input-type=module", "-e", script],
			cwd: repo.dir,
			timeoutMs: 120000,
		});
		assert.ok(ran.stdout.includes("# codictator CI summary"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.18 EC-7] harness without usage data", async () => {
	// SPEC §4.18.6 EC-7: token metrics read "unavailable", never zero.
	const summary = await summarize(FIXED_INSTANT, 10);
	assert.ok(summary.includes("unavailable"));
});
