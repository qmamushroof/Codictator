// Slice 0: the consumer conformance harness (SPEC §4.12.3, §4.6.2–4.6.3,
// §4.15). Every test builds a temp consumer repo with the real init writers
// and drives the real hook/CLI entry points through the installed launcher:
// no source greps, no fixture-only verdicts. Scenarios 1–7 start red (gaps
// G1–G6); later slices green them without changing what is asserted.
import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { type GuardrailPlan, guardrailPlan } from "../../src/cli/plan.ts";
import { parseJson } from "../../src/kernel/index.ts";
import {
	denyReason,
	installConsumer,
	runLauncher,
	srcMain,
	taskId,
	toPlanning,
	writePayload,
} from "../support/consumer-harness.ts";
import { createTempRepo } from "../support/temp-repo.ts";

test("[§4.12.3 EC-1] consumer edit with no task is blocked with the task-new message", async () => {
	const repo = createTempRepo();
	try {
		await installConsumer(repo);
		const result = await runLauncher(
			repo.dir,
			["hook", "muse-code", "PreToolUse"],
			JSON.stringify(
				writePayload(repo.dir, "src/a.ts", "export const a = 1;\n"),
			),
		);
		const reason = denyReason(result.stdout);
		assert.ok(
			reason !== undefined,
			`G1: no-task edit allowed: ${result.stdout}${result.stderr}`,
		);
		assert.match(reason, /core\/workflow-gates/);
		assert.match(reason, /codictator task new/);
	} finally {
		repo.cleanup();
	}
});

test("[§4.12.7 EC-2] consumer planning task allows test writes but blocks src writes before red proof", async () => {
	const repo = createTempRepo();
	try {
		await installConsumer(repo);
		const id = await taskId(repo, "consumer widget");
		await toPlanning(repo, id);
		const allowed = await runLauncher(
			repo.dir,
			["hook", "muse-code", "PreToolUse"],
			JSON.stringify(
				writePayload(
					repo.dir,
					"tests/widget.test.ts",
					'test("widget", () => {});\n',
				),
			),
		);
		assert.equal(
			denyReason(allowed.stdout),
			undefined,
			`planning test write blocked: ${allowed.stdout}${allowed.stderr}`,
		);
		const blocked = await runLauncher(
			repo.dir,
			["hook", "muse-code", "PreToolUse"],
			JSON.stringify(
				writePayload(repo.dir, "src/widget.ts", "export const w = 1;\n"),
			),
		);
		const reason = denyReason(blocked.stdout);
		assert.ok(
			reason !== undefined,
			`G1/G2: src write before red proof allowed: ${blocked.stdout}`,
		);
		assert.match(reason, /red|proof|task/i);
	} finally {
		repo.cleanup();
	}
});

test("[§4.12.7 EC-3] consumer write outside files.allow is blocked with the amend hint", async () => {
	const repo = createTempRepo();
	try {
		await installConsumer(repo);
		const id = await taskId(repo, "consumer narrow");
		await toPlanning(repo, id);
		const narrowed = await srcMain(
			["task", "amend", "--id", id, "--set-allow", "tests/**"],
			repo.dir,
		);
		assert.equal(narrowed.code, 0, `narrow failed: ${narrowed.stderr}`);
		const result = await runLauncher(
			repo.dir,
			["hook", "muse-code", "PreToolUse"],
			JSON.stringify(
				writePayload(repo.dir, "src/other.ts", "export const o = 1;\n"),
			),
		);
		const reason = denyReason(result.stdout);
		assert.ok(
			reason !== undefined,
			`G1/G2: out-of-allow write allowed: ${result.stdout}`,
		);
		assert.match(reason, /codictator task amend/);
	} finally {
		repo.cleanup();
	}
});

test("[§4.6.3] consumer SessionStart reply carries additionalContext", async () => {
	const repo = createTempRepo();
	try {
		await installConsumer(repo);
		const result = await runLauncher(
			repo.dir,
			["hook", "muse-code", "SessionStart"],
			JSON.stringify({ session_id: "sess-consumer-0", cwd: repo.dir }),
		);
		assert.match(
			result.stdout,
			/additionalContext/,
			`G3: startup reply carries no injection: ${result.stdout}`,
		);
		assert.match(result.stdout, /codictator task new/);
	} finally {
		repo.cleanup();
	}
});

test("[§4.6.2] consumer AGENTS.md lists every loaded floor rule within 6,000 bytes", async () => {
	const repo = createTempRepo();
	try {
		await installConsumer(repo);
		const block = readFileSync(path.join(repo.dir, "AGENTS.md"), "utf8");
		assert.ok(
			Buffer.byteLength(block, "utf8") <= 6000,
			`managed block exceeds 6,000 bytes`,
		);
		const { loadBuiltinPack } = await import(
			"../../src/features/packs/loader.ts"
		);
		const core = await loadBuiltinPack("core");
		assert.ok(core.ok, "core pack loads");
		if (core.ok) {
			const missing = core.value.manifest.rules
				.filter((rule) => rule.tier === "floor")
				.map((rule) => rule.id)
				.filter((id) => !block.includes(id));
			assert.deepEqual(
				missing,
				[],
				`G4: ${missing.length} floor rules missing from AGENTS.md: ${missing.join(", ")}`,
			);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.12.3 L3] consumer pre-commit without an active record-phase task is blocked", async () => {
	const repo = createTempRepo();
	try {
		await installConsumer(repo);
		writeFileSync(path.join(repo.dir, "src/ship.ts"), "export const s = 1;\n");
		repo.git(["add", "src/ship.ts"]);
		const result = await runLauncher(repo.dir, ["git", "pre-commit"]);
		assert.notEqual(result.code, 0, `G5: taskless commit passes pre-commit`);
		assert.match(result.stdout, /task/i);
	} finally {
		repo.cleanup();
	}
});

test("[§4.9.3] consumer commit-msg without a staged history entry is blocked", async () => {
	const repo = createTempRepo();
	try {
		await installConsumer(repo);
		writeFileSync(path.join(repo.dir, "src/ship.ts"), "export const s = 1;\n");
		repo.git(["add", "src/ship.ts"]);
		const msgFile = path.join(repo.dir, "COMMIT_MSG");
		writeFileSync(msgFile, "feat: consumer thing\n", "utf8");
		const result = await runLauncher(repo.dir, ["git", "commit-msg", msgFile]);
		assert.notEqual(result.code, 0, `G5: history-less commit-msg passes`);
		assert.match(result.stdout, /history/i);
	} finally {
		repo.cleanup();
	}
});

test("[§4.15] consumer workflow runs ci verify from the installed launcher", async () => {
	// Drives the real init plan writer (init itself is TTY-gated; existing
	// suites use this same writer). Red today: the sibling slice-4 edit left
	// renderWorkflow throwing, and the pre-edit render pinned
	// `packages/codictator/dist`.
	let plan: GuardrailPlan | undefined;
	try {
		plan = guardrailPlan(["opencode"], "", "demo-consumer", undefined);
	} catch (error) {
		assert.fail(
			`G6: init cannot render the consumer workflow: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const yml =
		plan.files.find((file) => file.path === ".github/workflows/codictator.yml")
			?.content ?? "";
	const verify = yml
		.split("\n")
		.filter((line) => line.includes("ci verify"))
		.join("\n");
	assert.ok(
		verify !== "" && !verify.includes("packages/codictator/dist"),
		`G6: verify still runs from the source tree: ${verify}`,
	);
});

test("[§4.15] consumer ci verify fails history-entry on a codeless-history range with tracked BUGS", async () => {
	const repo = createTempRepo();
	try {
		await installConsumer(repo);
		repo.writeFile(
			"docs/BUGS/2026.md",
			"# Bugs — 2026\n\n| Id | Status | Title | Found | Fix | Regression test |\n|---|---|---|---|---|---|\n",
		);
		repo.git(["add", "-A"]);
		repo.git(["commit", "--no-verify", "-m", "track the bug file"]);
		const base = repo.git(["rev-parse", "HEAD"]).trim();
		writeFileSync(path.join(repo.dir, "src/thing.ts"), "export const t = 1;\n");
		repo.git(["add", "src/thing.ts"]);
		repo.git(["commit", "--no-verify", "-m", "feat: consumer thing"]);
		const head = repo.git(["rev-parse", "HEAD"]).trim();
		const result = await srcMain(
			["--json", "ci", "verify", "--base", base, "--head", head],
			repo.dir,
		);
		assert.equal(
			result.code,
			1,
			`G6: codeless-history range passes: ${result.stdout}`,
		);
		const parsed = parseJson(result.stdout.slice(result.stdout.indexOf("{")));
		assert.ok(parsed.ok, `no JSON findings: ${result.stdout}`);
		const ids = (
			(parsed.value as { findings: Array<{ ruleId: string }> }).findings ?? []
		).map((finding) => finding.ruleId);
		assert.ok(
			ids.includes("core/history-entry"),
			`G6: history-entry silent with tracked BUGS: ${ids.join(", ")}`,
		);
	} finally {
		repo.cleanup();
	}
});
