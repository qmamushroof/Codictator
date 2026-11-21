// Roadmap 14.4, session family: the L1 rules whose evidence lives in the
// session, not in one write: the read cache (a repeat read) and the L0
// integrity checks at session start. The umbrella title in
// consumer-enforcement-firing-l1.test.ts stays ledger-listed until every
// family is green; this per-family guard asserts exactly these rows.
import { strict as assert } from "node:assert";
import test from "node:test";
import { runL1Probes, silentRules } from "../support/consumer-l1-run.ts";
import { createTempRepo } from "../support/temp-repo.ts";

const SESSION_FAMILY: ReadonlySet<string> = new Set([
	"core/read-dedupe",
	"core/guardrail-manifest",
	"core/hooks-active",
	"core/engine-version-match",
]);

test("[consumer] the session-evidence L1 floor rules fire on their probes", async () => {
	const repo = createTempRepo();
	try {
		const hits = await runL1Probes(repo);
		const misses = silentRules(hits, (rule) => SESSION_FAMILY.has(rule));
		assert.deepEqual(
			misses,
			[],
			`${misses.length} session-family L1 rules silent:\n${misses.join("\n")}`,
		);
	} finally {
		repo.cleanup();
	}
});

// SPEC §4.6.5 + §5 (L0, L4): the session-start probe leaves a project .mcp.json
// naming a server config.steering.mcpAllowed does not list.
test("[consumer] core/mcp-declared fires at session start on an undeclared project MCP server", async () => {
	const repo = createTempRepo();
	try {
		const hits = await runL1Probes(repo);
		const hit = hits.get("session::core/mcp-declared");
		assert.ok(hit !== undefined, "session probe recorded no result");
		assert.ok(hit.fired, `rule silent: ${hit.detail}`);
	} finally {
		repo.cleanup();
	}
});
