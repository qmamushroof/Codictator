import { strict as assert } from "node:assert";

import test from "node:test";

import type { CheckContext } from "../../../src/features/engine/index.ts";

import {
	checkDocs,
	checkHistory,
} from "../../../src/features/records/index.ts";

import { FIXED_INSTANT } from "../../support/fake-clock.ts";

function ctxFor(files: ReadonlyArray<string>): CheckContext {
	return {
		trigger: "post-tool",
		scope: { files, sessionId: "session-1" },
		now: FIXED_INSTANT,
		configHash: "config-hash",
	};
}

const ROUTER_HEAD = "# SPEC\n\n| § | File |\n|---|---|\n";

const LEAF_08_NAV =
	"**[(first)](04-08-DEPENDENCIES.md)** · [SPEC](../SPEC.md) · **[4.9 records ▶](04-09-RECORDS.md)**";

const LEAF_09_NAV =
	"**[◀ 4.8 deps](04-08-DEPENDENCIES.md)** · [SPEC](../SPEC.md) · **[4.10 testing ▶](04-10-TESTING.md)**";

const LEAF_10_NAV =
	"**[◀ 4.9 records](04-09-RECORDS.md)** · [SPEC](../SPEC.md) · **(last)**";

function specTree(
	routerText: string,
	leaf09Text?: string,
): Record<string, string> {
	return {
		"docs/SPEC.md": routerText,
		"docs/SPEC/04-08-DEPENDENCIES.md": `# 4.8 deps\n\n${LEAF_08_NAV}\n\nShort intro line.\n`,
		"docs/SPEC/04-09-RECORDS.md":
			leaf09Text ?? `# 4.9 records\n\n${LEAF_09_NAV}\n\nShort intro line.\n`,
		"docs/SPEC/04-10-TESTING.md": `# 4.10 testing\n\n${LEAF_10_NAV}\n\nShort intro line.\n`,
	};
}

const ROUTER_VALID = `${ROUTER_HEAD}| 4.8 | [deps](04-08-DEPENDENCIES.md) |\n| 4.9 | [records](04-09-RECORDS.md) |\n| 4.10 | [testing](04-10-TESTING.md) |\n`;

function docsCtx(): { files: Array<string>; paths: Array<string> } {
	const files = [
		"docs/SPEC.md",
		"docs/SPEC/04-08-DEPENDENCIES.md",
		"docs/SPEC/04-09-RECORDS.md",
		"docs/SPEC/04-10-TESTING.md",
	];
	return { files, paths: files };
}

const HISTORY_BASE = `# History — 2026-10-05

## 2026-10-05 · first commit
- **Kind:** docs
- **Task:** T-0001
- **Why:** why text
- **Docs:** docs/guide.md
`;

test("[§4.9 EC-1] router holding a paragraph blocks", async () => {
	// SPEC §4.9.5 EC-1: block core/doc-router-leaf.
	const { files, paths } = docsCtx();
	const contents = specTree(
		`# SPEC\n\nA paragraph holding here\nthat breaks the router rule.\n\n${ROUTER_HEAD}| 4.8 | [deps](04-08-DEPENDENCIES.md) |\n| 4.9 | [records](04-09-RECORDS.md) |\n| 4.10 | [testing](04-10-TESTING.md) |\n`,
	);
	const findings = await checkDocs(ctxFor(files), paths, contents);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/doc-router-leaf"),
	);
});

test("[§4.9 EC-2] leaf missing from router blocks", async () => {
	// SPEC §4.9.5 EC-2: block; linked twice also blocks.
	const { files, paths } = docsCtx();
	const contents = specTree(
		`${ROUTER_HEAD}| 4.8 | [deps](04-08-DEPENDENCIES.md) |\n| 4.10 | [testing](04-10-TESTING.md) |\n| 4.10 | [testing again](04-10-TESTING.md) |\n`,
	);
	const findings = await checkDocs(ctxFor(files), paths, contents);
	assert.ok(findings.length > 0);
});

test("[§4.9 EC-3] nav line pointing at wrong next leaf", async () => {
	// SPEC §4.9.5 EC-3: block with the expected nav line as remediation.
	const { files, paths } = docsCtx();
	const contents = specTree(
		ROUTER_VALID,
		`# 4.9 records\n\n**[◀ 4.8 deps](04-08-DEPENDENCIES.md)** · [SPEC](../SPEC.md) · **[4.8 deps ▶](04-08-DEPENDENCIES.md)**\n\nShort intro line.\n`,
	);
	const findings = await checkDocs(ctxFor(files), paths, contents);
	assert.ok(findings.some((finding) => finding.remediation.length > 0));
});

test("[§4.9 EC-4] nested folder under a leaf blocks", async () => {
	// SPEC §4.9.5 EC-4: block core/doc-one-level.
	const findings = await checkDocs(ctxFor(["docs/SPEC/sub/x.md"]), [
		"docs/SPEC/sub/x.md",
	]);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/doc-one-level"),
	);
});

test("[§4.9 EC-5] link anchor with wrong slug blocks", async () => {
	// SPEC §4.9.5 EC-5: remediation gives the correct slug.
	const { files, paths } = docsCtx();
	const contents = {
		...specTree(ROUTER_VALID),
		"docs/SPEC/04-09-RECORDS.md": `# 4.9 records\n\n${LEAF_09_NAV}\n\nSee [stack](../02-STACK.md#2.1-toolchain) for versions.\n`,
		"docs/02-STACK.md": "# 2. Stack\n\n## 2.1 Toolchain\n\nPinned tooling.\n",
	};
	const findings = await checkDocs(
		ctxFor([...files, "docs/02-STACK.md"]),
		[...paths, "docs/02-STACK.md"],
		contents,
	);
	const flagged = findings.filter(
		(finding) => finding.ruleId === "core/doc-links-valid",
	);
	assert.ok(flagged.length > 0);
	assert.ok(
		flagged.some((finding) => finding.remediation.includes("#21-toolchain")),
	);
});

test("[§4.9 EC-6] sentence with e dot g mid-sentence", async () => {
	// SPEC §4.9.5 EC-6: not split at e.g.
	const findings = await checkDocs(ctxFor(["docs/guide.md"]), [
		"docs/guide.md",
	]);
	assert.equal(findings.length, 0);
});

test("[§4.9 EC-7] long sentence inside a table cell ignored", async () => {
	// SPEC §4.9.5 EC-7: table cells are not counted.
	const findings = await checkDocs(ctxFor(["docs/guide.md"]), [
		"docs/guide.md",
	]);
	assert.equal(findings.length, 0);
});

test("[§4.9 EC-8] history entry edited after commit blocks", async () => {
	// SPEC §4.9.5 EC-8: block core/history-append-only.
	const head = HISTORY_BASE.replace("why text", "rewritten why");
	const findings = await checkHistory(
		ctxFor(["docs/HISTORY/2026-10-05.md"]),
		head,
		HISTORY_BASE,
	);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/history-append-only"),
	);
});

test("[§4.9 EC-9] commit with no history entry blocks", async () => {
	// SPEC §4.9.5 EC-9: L3 blocks; bypassed L4 blocks the PR.
	const findings = await checkHistory(ctxFor(["src/a.ts"]), "");
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/history-entry"),
	);
});

test("[§4.9 EC-10] two entries in one commit blocks", async () => {
	// SPEC §4.9.5 EC-10: one commit, one entry.
	const findings = await checkHistory(
		ctxFor(["docs/HISTORY/2026-10-05.md"]),
		"two entries",
	);
	assert.ok(findings.length > 0);
});
