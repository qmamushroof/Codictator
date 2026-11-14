// SPEC §4.3.2 + §4.7: the L1 hook scope is the tool call (files is empty),
// so content rules judge it through the one pre-tool file adapter: the
// proposed target with the text the call carries. Before the adapter the
// history, deps, ts and python content rules looped ctx.scope.files and
// never saw an L1 write, and a read-only call was never kept apart.
import { strict as assert } from "node:assert";
import test from "node:test";
import { parseClaudeShapedEvent } from "../../../src/features/adapters/claude-shaped.ts";
import { hookScope } from "../../../src/features/adapters/hook-scope.ts";
import { parseOpenCodeEvent } from "../../../src/features/adapters/opencode-parse.ts";
import type { Finding, Scope } from "../../../src/features/engine/index.ts";
import { resolveDepExactPin } from "../../../src/features/packs/enforcers/deps-guards.ts";
import { resolveDepOnePerCapability } from "../../../src/features/packs/enforcers/deps-policy-guards.ts";
import { resolveHistoryAppendOnly } from "../../../src/features/packs/enforcers/records-history-guards.ts";
import { FakeFs } from "../../support/fake-fs.ts";
import { FakeGit } from "../../support/fake-git.ts";
import {
	checked,
	ctxFor,
	DECL,
	editScope,
	portsWith,
	readScope,
	ruleFor,
	ruleIds,
	writeScope,
} from "../../support/pre-tool-scenario.ts";

const HISTORY_PATH = "docs/HISTORY/2026-11-08.md";
const HISTORY_TITLE = "# History — 2026-11-08\n\n";
const HISTORY_ENTRY =
	"## 2026-11-08 · fix: hold the line\n\n- **Kind:** code\n- **Task:** T-0001\n- **Why:** reason\n- **What went wrong:** none\n- **Trade-offs:** none\n- **Lessons:** learned\n";
const NEWER_ENTRY = HISTORY_ENTRY.replace("hold the line", "newer entry");

async function historyFindings(scope: Scope): Promise<Array<Finding>> {
	const git = new FakeGit();
	git.setShow("HEAD", HISTORY_PATH, `${HISTORY_TITLE}${HISTORY_ENTRY}`);
	const enforcer = checked(
		resolveHistoryAppendOnly(
			DECL,
			ruleFor("core/history-append-only"),
			portsWith(new FakeFs(), git),
		),
	);
	return enforcer.check(ctxFor(scope), {});
}

test("[§4.3.2] L1 history-append-only judges the proposed whole-file content against HEAD", async () => {
	const rewritten = `${HISTORY_TITLE}${HISTORY_ENTRY.replace("reason", "rewritten")}`;
	assert.ok(
		ruleIds(
			await historyFindings(writeScope(HISTORY_PATH, rewritten)),
		).includes("core/history-append-only"),
	);
	const prepended = `${HISTORY_TITLE}${NEWER_ENTRY}\n${HISTORY_ENTRY}`;
	assert.deepEqual(
		await historyFindings(writeScope(HISTORY_PATH, prepended)),
		[],
	);
});

test("[§4.3.2] L1 history-append-only does not judge an edit fragment as a whole file", async () => {
	assert.deepEqual(
		await historyFindings(editScope(HISTORY_PATH, NEWER_ENTRY)),
		[],
	);
});

test("[§4.12.3] L1 history-append-only does not judge a read-only call", async () => {
	assert.deepEqual(await historyFindings(readScope(HISTORY_PATH)), []);
});

async function pinFindings(scope: Scope): Promise<Array<Finding>> {
	const enforcer = checked(
		resolveDepExactPin(
			DECL,
			ruleFor("core/dep-exact-pin"),
			portsWith(new FakeFs()),
		),
	);
	return enforcer.check(ctxFor(scope), {});
}

const RANGE_MANIFEST = '{"dependencies":{"left-pad":"^1.0.0"}}\n';
const PINNED_MANIFEST = '{"dependencies":{"left-pad":"1.0.0"}}\n';

test("[§4.3.2] L1 dep-exact-pin judges the proposed package.json content", async () => {
	assert.ok(
		ruleIds(
			await pinFindings(writeScope("package.json", RANGE_MANIFEST)),
		).includes("core/dep-exact-pin"),
	);
	assert.deepEqual(
		await pinFindings(writeScope("package.json", PINNED_MANIFEST)),
		[],
	);
});

test("[§4.3.2] L1 dep-exact-pin does not judge an edit fragment or a read", async () => {
	assert.deepEqual(
		await pinFindings(editScope("package.json", '"left-pad": "^1.0.0"')),
		[],
	);
	assert.deepEqual(await pinFindings(readScope("package.json")), []);
});

test("[§4.3.2] L1 dep-exact-pin judges proposed requirements lines", async () => {
	assert.ok(
		ruleIds(
			await pinFindings(writeScope("requirements.txt", "requests>=2\n")),
		).includes("core/dep-exact-pin"),
	);
});

test("[§4.3.2] L1 dep-exact-pin skips a requirements edit fragment", async () => {
	assert.deepEqual(
		await pinFindings(editScope("requirements.txt", "requests>=2\n")),
		[],
	);
});

async function capabilityFindings(scope: Scope): Promise<Array<Finding>> {
	const enforcer = checked(
		resolveDepOnePerCapability(
			DECL,
			ruleFor("core/dep-one-per-capability"),
			portsWith(new FakeFs()),
		),
	);
	return enforcer.check(ctxFor(scope), {});
}

test("[§4.3.2] L1 dep-one-per-capability judges the proposed package.json content", async () => {
	const twoFormatters =
		'{"devDependencies":{"prettier":"3.0.0","@biomejs/biome":"2.0.0"}}\n';
	assert.ok(
		ruleIds(
			await capabilityFindings(writeScope("package.json", twoFormatters)),
		).includes("core/dep-one-per-capability"),
	);
	assert.deepEqual(await capabilityFindings(readScope("package.json")), []);
});

function claudeScope(input: Record<string, unknown>): Scope {
	const parsed = parseClaudeShapedEvent(
		"muse-code",
		"PreToolUse",
		{
			session_id: "s1",
			cwd: "/repo",
			hook_event_name: "PreToolUse",
			tool_name: "Write",
			tool_input: input,
		},
		{ Write: "write" },
	);
	assert.equal(parsed.ok, true);
	if (!parsed.ok) {
		throw new Error("parse failed");
	}
	return hookScope(parsed.value, "/repo");
}

test("[§4.3.2] L1 hook scope marks a whole-file write and not an edit fragment", () => {
	const whole = claudeScope({ file_path: "/repo/a.ts", content: "x\n" });
	assert.equal(whole.proposedContentWhole, true);
	const edit = claudeScope({
		file_path: "/repo/a.ts",
		old_string: "a",
		new_string: "b",
	});
	assert.equal(edit.proposedContent, "b");
	assert.notEqual(edit.proposedContentWhole, true);
});

test("[§4.5.8] opencode parse marks a whole-file write and not an edit fragment", () => {
	const wholeEvent = parseOpenCodeEvent("tool.execute.before", {
		sessionID: "s1",
		cwd: "/repo",
		tool: "write",
		args: { filePath: "/repo/a.ts", content: "x\n" },
	});
	assert.equal(wholeEvent.ok, true);
	if (!wholeEvent.ok) {
		return;
	}
	assert.equal(wholeEvent.value.tool?.proposedContentWhole, true);
	const editEvent = parseOpenCodeEvent("tool.execute.before", {
		sessionID: "s1",
		cwd: "/repo",
		tool: "edit",
		args: { filePath: "/repo/a.ts", oldString: "a", newString: "b" },
	});
	assert.equal(editEvent.ok, true);
	if (!editEvent.ok) {
		return;
	}
	assert.notEqual(editEvent.value.tool?.proposedContentWhole, true);
});
