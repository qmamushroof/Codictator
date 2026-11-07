// SPEC §4.18.3 D9: one shared health builder feeds both the status
// screen and the stdio status row. Every field renders from live state:
// the active task phase, waivers count and soonest expiry, the ratchet
// baseline against the last L5 trend, registry-snapshot age, integrity
// exceptions, escalations and remediation progress.
import { strict as assert } from "node:assert";
import test from "node:test";
import { collectHealthFields } from "../../../src/cli/inspect-health.ts";
import { dispatchMethod } from "../../../src/cli/serve-methods.ts";
import { field } from "../../../src/cli/serve-shared.ts";
import type { EventLogLine } from "../../../src/features/audit/index.ts";
import type { Decision } from "../../../src/kernel/index.ts";
import { createTempRepo } from "../../support/temp-repo.ts";

const NOW = "2026-11-07T00:00:00.000Z";

function configJson(): string {
	return JSON.stringify({
		version: 1,
		codictator: "9.9.9",
		packs: [{ id: "core" }],
		harnesses: ["opencode"],
	});
}

function verdictLine(
	id: string,
	layer: string,
	decision: string,
	extra: Record<string, unknown> = {},
): string {
	return `${JSON.stringify({
		v: 1,
		id,
		ts: NOW,
		now: NOW,
		kind: "verdict",
		layer,
		trigger: "pre-tool",
		ruleIds: ["core/dead-code"],
		decision,
		durationMs: 5,
		configHash: "abc",
		packs: { core: "9.9.9" },
		...extra,
	})}\n`;
}

function taskJson(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		version: 1,
		id: "T-0001",
		type: "fix",
		title: "health",
		branch: "main",
		phase: "implementation",
		phases: [],
		spec: [],
		acceptanceCriteria: [],
		files: { allow: [] },
		...overrides,
	});
}

function l5Event(id: string, decision: Decision): EventLogLine {
	return {
		v: 1,
		id,
		ts: NOW,
		now: NOW,
		kind: "verdict",
		layer: "L5",
		trigger: "pre-tool",
		ruleIds: ["core/dead-code"],
		decision,
		durationMs: 5,
		configHash: "abc",
		packs: { core: "9.9.9" },
	};
}

function escalationEvent(id: string): EventLogLine {
	return {
		v: 1,
		id,
		ts: NOW,
		now: NOW,
		kind: "escalation",
		layer: "L1",
		trigger: "pre-tool",
		ruleIds: ["core/loop-breaker"],
		durationMs: 1,
		configHash: "abc",
		packs: {},
	};
}

function seedRepo(): ReturnType<typeof createTempRepo> {
	const repo = createTempRepo({
		".codictator/config.json": configJson(),
		".codictator/tasks/T-0001.json": taskJson(),
		".codictator/waivers.json": JSON.stringify({
			version: 1,
			maxWaiverDays: 30,
			waivers: [
				{
					id: "W-0001",
					rule: "core/no-secrets",
					params: {},
					paths: [],
					reason: "test",
					created: "2026-11-01",
					expires: "2026-12-01",
					createdBy: "human",
				},
				{
					id: "W-0002",
					rule: "core/dead-code",
					params: {},
					paths: [],
					reason: "test",
					created: "2026-11-01",
					expires: "2026-11-20",
					createdBy: "human",
				},
			],
		}),
		".codictator/baseline.json": JSON.stringify({
			version: 1,
			entries: { "core/dead-code@1": { "src/a.ts": 2 } },
		}),
		".codictator/registry-snapshot.json": JSON.stringify({
			fetchedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
		}),
		".codictator/plan/remediation.json": JSON.stringify({
			version: 1,
			steps: [
				{ id: "S-0001", status: "done" },
				{ id: "S-0002", status: "open" },
			],
		}),
		".codictator/state/events.jsonl": [
			verdictLine("evt-1", "L5", "allow"),
			verdictLine("evt-2", "L5", "block"),
			`${JSON.stringify({
				v: 1,
				id: "evt-3",
				ts: NOW,
				now: NOW,
				kind: "escalation",
				layer: "L1",
				trigger: "pre-tool",
				ruleIds: ["core/loop-breaker"],
				durationMs: 1,
				configHash: "abc",
				packs: {},
			})}\n`,
		].join(""),
	});
	return repo;
}

test("[§4.18] health renders every field from live state", async () => {
	// SPEC §4.18.3: task phase, waivers count/expiry, ratchet trend, deps
	// freshness, integrity, escalations and remediation done/total.
	const repo = seedRepo();
	try {
		const events = [
			l5Event("evt-1", "allow"),
			l5Event("evt-2", "block"),
			escalationEvent("evt-3"),
		];
		const fields = await collectHealthFields(
			repo.dir,
			events,
			new Date().toISOString(),
		);
		assert.ok(fields.task?.includes("T-0001"));
		assert.ok(fields.task?.includes("implementation"));
		assert.ok(fields.waivers?.includes("2 in force"));
		assert.ok(fields.waivers?.includes("2026-11-20"));
		assert.ok(fields.ratchet?.includes("1 baselined"));
		assert.ok(fields.ratchet?.includes("L5"));
		assert.ok(fields.deps?.includes("fresh"));
		assert.equal(fields.integrity, "clear");
		assert.ok(fields.escalations?.includes("1"));
		assert.ok(fields.remediation?.includes("1/2 done"));
		assert.ok(fields.remediation?.includes("S-0002"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] health marks pending integrity and stale deps", async () => {
	// A task with an unacknowledged exception reads pending; a snapshot
	// older than 24 h reads stale per §4.8.4.
	const repo = createTempRepo({
		".codictator/config.json": configJson(),
		".codictator/tasks/T-0001.json": taskJson({
			integrityExceptions: ["core/dead-code"],
			reviews: [],
		}),
		".codictator/registry-snapshot.json": JSON.stringify({
			fetchedAt: "2026-10-01T00:00:00.000Z",
		}),
	});
	try {
		const fields = await collectHealthFields(repo.dir, [], NOW);
		assert.ok(fields.integrity?.includes("1 pending"));
		assert.ok(fields.deps?.includes("stale"));
		assert.ok(fields.task?.includes("T-0001"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.18] serve and inspect status share one health builder", async () => {
	// No duplication: the stdio row carries exactly the fields the
	// shared builder collects for the same repo and events.
	const repo = seedRepo();
	try {
		const outcome = await dispatchMethod("status", undefined, {
			root: repo.dir,
			engineVersion: "9.9.9",
		});
		assert.equal(outcome.ok, true);
		if (outcome.ok) {
			const value = recordOf(outcome.value);
			const events = [
				l5Event("evt-1", "allow"),
				l5Event("evt-2", "block"),
				escalationEvent("evt-3"),
			];
			const fields = await collectHealthFields(
				repo.dir,
				events,
				new Date().toISOString(),
			);
			assert.equal(field(value, "task"), fields.task ?? null);
			assert.equal(field(value, "waivers"), fields.waivers ?? null);
			assert.equal(field(value, "ratchet"), fields.ratchet ?? null);
			assert.equal(field(value, "deps"), fields.deps ?? null);
			assert.equal(field(value, "integrity"), fields.integrity ?? null);
			assert.equal(field(value, "escalations"), fields.escalations ?? null);
			assert.equal(field(value, "remediation"), fields.remediation ?? null);
		}
	} finally {
		repo.cleanup();
	}
});

function recordOf(value: unknown): Record<string, unknown> {
	assert.equal(typeof value, "object");
	assert.notEqual(value, null);
	return value as Record<string, unknown>;
}
