// SPEC §4.3.2 + §4.7.3: pre-tool guards see the tool targets. Before the
// fix, the L1 scope left `files` empty while tool targets rode
// `proposedPaths`, so every pre-tool Edit passed unjudged (G2). The fallback
// is lexical only: new targets never pay a fail-closed disk read.
import { strict as assert } from "node:assert";
import test from "node:test";
import type {
	CheckContext,
	Enforcer,
	Finding,
} from "../../../src/features/engine/index.ts";
import { resolveHistoryAppendOnly } from "../../../src/features/packs/enforcers/records-history-guards.ts";
import { resolveWritesWithinPlan } from "../../../src/features/packs/enforcers/workflow-guards.ts";
import { writesWithinPlanReal } from "../../../src/features/packs/enforcers/workflow-real.ts";
import type { TaskRecord } from "../../../src/features/workflow/index.ts";
import type {
	PackRule,
	Ports,
	ProcResult,
	Result,
} from "../../../src/kernel/index.ts";
import { makeError, stableStringify } from "../../../src/kernel/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";
import { FakeFs } from "../../support/fake-fs.ts";
import { FakeGit } from "../../support/fake-git.ts";
import { createFakePorts } from "../../support/fake-ports.ts";

const DECL = { id: "test-enforcer", kind: "code", budgetMs: 1000 } as const;

const BRANCH_ARGV = ["git", "branch", "--show-current"];

function ruleFor(id: string, triggers: Array<string>): PackRule {
	return {
		id,
		family: "test",
		tier: "floor",
		statement: "a rule",
		reason: "testing",
		remediation: "fix it",
		enforcer: "test-enforcer",
		triggers,
		scope: [],
		params: {},
		measureVersion: 1,
		fixtures: { violating: [], passing: [] },
	};
}

function branchResult(stdout: string): ProcResult {
	return { code: 0, stdout, stderr: "", timedOut: false, truncated: false };
}

// Ports with a scripted branch lookup. A missing branch result keeps the
// bundle's git-missing probe, so `root()` fails and the branch is unreadable.
function portsFor(fs: FakeFs, branch: ProcResult | undefined): Ports {
	const bundle = createFakePorts();
	if (branch === undefined) {
		return { ...bundle.ports, fs };
	}
	bundle.proc.when(BRANCH_ARGV, branch);
	return { ...bundle.ports, fs, git: new FakeGit() };
}

function seedTask(
	fs: FakeFs,
	init: {
		readonly id: string;
		readonly branch: string;
		readonly type: string;
		readonly phase: string;
		readonly allow: ReadonlyArray<string>;
	},
): void {
	const record: TaskRecord = {
		version: 1,
		id: init.id,
		type: init.type,
		title: `task ${init.id}`,
		branch: init.branch,
		phase: init.phase,
		phases: [],
		spec: ["§4.3.2"],
		acceptanceCriteria: ["the target is judged against the branch task"],
		files: { allow: [...init.allow] },
	};
	fs.seedText(
		`.codictator/tasks/${init.id}.json`,
		`${stableStringify(record)}\n`,
	);
}

function checked(resolved: Result<Enforcer>): Enforcer {
	assert.equal(resolved.ok, true);
	if (!resolved.ok) {
		throw new Error("resolver failed");
	}
	return resolved.value;
}

function ruleIds(findings: ReadonlyArray<Finding>): Array<string> {
	return findings.map((finding) => finding.ruleId);
}

test("[§4.3.2] L1 pre-tool judges proposedPaths when files is empty", async () => {
	const ports = portsFor(new FakeFs(), branchResult("fix/x\n"));
	const enforcer = checked(
		resolveWritesWithinPlan(
			DECL,
			ruleFor("core/writes-within-plan", ["pre-tool"]),
			ports,
		),
	);
	const ctx: CheckContext = {
		trigger: "pre-tool",
		scope: { files: [], proposedPaths: ["src/a.ts"] },
		now: FIXED_INSTANT,
		configHash: "test-hash",
	};
	const findings = await enforcer.check(ctx, {});
	assert.ok(ruleIds(findings).includes("core/workflow-gates"));
});

const HISTORY_TITLE = "# History — 2026-11-08\n\n";
const HISTORY_ENTRY =
	"## 2026-11-08 · fix: hold the line\n\n- **Kind:** code\n- **Task:** T-0001\n- **Why:** reason\n- **What went wrong:** none\n- **Trade-offs:** none\n- **Lessons:** learned\n";

test("[§4.7.3] L1 history-append-only judges an edited pre-tool target", async () => {
	const path = "docs/HISTORY/2026-11-08.md";
	const fs = new FakeFs();
	fs.seedText(
		path,
		`${HISTORY_TITLE}${HISTORY_ENTRY.replace("reason", "rewritten")}`,
	);
	const git = new FakeGit();
	git.setShow("HEAD", path, `${HISTORY_TITLE}${HISTORY_ENTRY}`);
	const bundle = createFakePorts();
	bundle.proc.when(BRANCH_ARGV, branchResult("fix/x\n"));
	const ports: Ports = { ...bundle.ports, fs, git };
	const enforcer = checked(
		resolveHistoryAppendOnly(
			DECL,
			ruleFor("core/history-append-only", ["pre-tool"]),
			ports,
		),
	);
	const ctx: CheckContext = {
		trigger: "pre-tool",
		scope: { files: [], proposedPaths: [path] },
		now: FIXED_INSTANT,
		configHash: "test-hash",
	};
	const findings = await enforcer.check(ctx, {});
	assert.ok(ruleIds(findings).includes("core/history-append-only"));
});

// Diagnostic and gate-leg scopes (verify, pre-commit, pre-push) carry no
// tool targets, so with no task they stay silent; L3/L4 tasklessness is
// owned by its own slice.
test("[§4.12.3] L1 gate-leg scope without tool targets stays silent with no task", async () => {
	const ports = portsFor(new FakeFs(), branchResult("fix/x\n"));
	assert.deepEqual(await writesWithinPlanReal(ports, ["src/a.ts"], false), []);
});

test("[§4.12.7 EC-11] L1 allows a docs write for the active task", async () => {
	const fs = new FakeFs();
	seedTask(fs, {
		id: "T-0001",
		branch: "fix/x",
		type: "feature",
		phase: "planning",
		allow: [],
	});
	const ports = portsFor(fs, branchResult("fix/x\n"));
	assert.deepEqual(
		await writesWithinPlanReal(ports, ["docs/notes.md"], true),
		[],
	);
});

// A new tool target has no HEAD base, so append-only skips it without
// touching the disk: the skipped read is lexical, never a disk probe.
class NoReadFs extends FakeFs {
	override read(_path: string): Promise<Result<Uint8Array>> {
		throw new Error("new targets must not be read");
	}
	override readText(_path: string): Promise<Result<string>> {
		throw new Error("new targets must not be read");
	}
}

test("[§4.7.3] L1 history-append-only skips a new pre-tool target unread", async () => {
	const path = "docs/HISTORY/2026-11-08.md";
	const fs = new NoReadFs();
	const git = new FakeGit();
	git.failNext(
		makeError("CDX-E703", "git show failed", "Run inside a git repository."),
	);
	const bundle = createFakePorts();
	bundle.proc.when(BRANCH_ARGV, branchResult("fix/x\n"));
	const ports: Ports = { ...bundle.ports, fs, git };
	const enforcer = checked(
		resolveHistoryAppendOnly(
			DECL,
			ruleFor("core/history-append-only", ["pre-tool"]),
			ports,
		),
	);
	const ctx: CheckContext = {
		trigger: "pre-tool",
		scope: { files: [], proposedPaths: [path] },
		now: FIXED_INSTANT,
		configHash: "test-hash",
	};
	assert.deepEqual(await enforcer.check(ctx, {}), []);
});
