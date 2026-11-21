// A one-rule custom pack (SPEC §4.4.1) under `.codictator/packs/<id>/`: a
// file-size rule whose violating case holds `violatingLines` rows. At 320
// rows the case violates and the self-test passes; at 5 it does not, so the
// self-test fails CDX-E212 (SPEC §4.4.8 EC-2). Shared by the pack-test CLI,
// the custom-pack loading and the L4 range tests, so the shape is written
// once.

export const CUSTOM_PACK_ID = "mypack";

function rows(count: number): string {
	const lines: Array<string> = [];
	for (let n = 1; n <= count; n += 1) {
		lines.push(`export const row${n} = 1;`);
	}
	return `${lines.join("\n")}\n`;
}

function caseJson(
	rule: string,
	expectation: "violating" | "passing",
	lines: number,
): string {
	return JSON.stringify({
		rule,
		section: "§5.6",
		expectation,
		trigger: "pre-tool",
		expectRules: expectation === "violating" ? [rule] : [],
		files: { "src/a.ts": rows(lines) },
	});
}

// Repo-relative path → content for the pack directory.
export function customPackFiles(
	violatingLines: number,
	id: string = CUSTOM_PACK_ID,
): Record<string, string> {
	const rule = `${id}/file-size`;
	const dir = `.codictator/packs/${id}`;
	return {
		[`${dir}/pack.json`]: JSON.stringify({
			id,
			version: "0.0.0",
			description: "fixture pack with a file-size rule",
			rules: [
				{
					id: rule,
					family: "F6",
					tier: "tunable",
					statement: "Files stay under maxLines lines.",
					reason: "Oversize files resist review.",
					remediation: "Split {path} below {limit} lines.",
					enforcer: rule,
					triggers: ["pre-tool"],
					scope: [],
					params: {
						maxLines: {
							type: "integer",
							default: 300,
							bound: 500,
							stricter: "lower",
						},
					},
					ratchet: false,
					measureVersion: 1,
					fixtures: { violating: ["basic"], passing: ["basic"] },
				},
			],
			enforcers: [{ id: rule, kind: "file-size", budgetMs: 1000, args: {} }],
			maxWaiverDays: 90,
		}),
		[`${dir}/fixtures/file-size/violating/basic/case.json`]: caseJson(
			rule,
			"violating",
			violatingLines,
		),
		[`${dir}/fixtures/file-size/passing/basic/case.json`]: caseJson(
			rule,
			"passing",
			5,
		),
	};
}

// SPEC §7.4: an accepted.json whose packHash no longer matches the pack
// (EC-4, edited after acceptance).
export function staleAcceptance(
	id: string = CUSTOM_PACK_ID,
): Record<string, string> {
	return {
		[`.codictator/packs/${id}/accepted.json`]: JSON.stringify({
			version: 1,
			packHash: "sha256:stale",
			selfTestHash: "sha256:stale",
			acceptedAt: "2026-01-01T00:00:00.000Z",
			acceptedBy: "human@example.invalid",
		}),
	};
}

// SPEC §7.2: a config.json naming the custom pack beside the builtins.
export function configWithCustom(id: string = CUSTOM_PACK_ID): string {
	return JSON.stringify({
		version: 1,
		codictator: "unknown",
		packs: [{ id: "typescript" }, { id }],
		harnesses: ["muse-code"],
	});
}
