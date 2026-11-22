// BUG-0117 (SPEC §4.9.2, §4.14.1): in a consumer repo, staged regen output the
// manifest lists never raises core/doc-single-owner, while two staged
// hand-written docs sharing a sentence still do.
import { strict as assert } from "node:assert";
import test from "node:test";
import { buildManifest } from "../../src/features/integrity/index.ts";
import { sha256Text, stableStringify } from "../../src/kernel/index.ts";
import {
	installConsumer,
	runLauncher,
	taskId,
	toPlanning,
} from "../support/consumer-harness.ts";
import { createTempRepo, type TempRepo } from "../support/temp-repo.ts";

const SHARED =
	"The shared consumer sentence carries more than twelve words so the owner check sees it twice.";
const GENERATED = [
	".agents/skills/codictator-bug-record/SKILL.md",
	".agents/skills/codictator-review/SKILL.md",
];

async function ownerFindings(
	files: ReadonlyArray<string>,
	listed: ReadonlyArray<string>,
): Promise<string> {
	const repo: TempRepo = createTempRepo();
	try {
		await installConsumer(repo);
		await toPlanning(repo, await taskId(repo, "owner probe"));
		const bodies = new Map<string, string>();
		for (const file of listed) {
			bodies.set(
				file,
				`# Doc

Unique text for ${file}.
`,
			);
		}
		for (const file of files) {
			bodies.set(
				file,
				`# Doc

${SHARED}
`,
			);
		}
		const artifacts = listed.map((path) => ({
			path,
			owner: "core",
			mode: "file" as const,
			hash: sha256Text(bodies.get(path) ?? ""),
		}));
		repo.writeFile(
			".codictator/manifest.json",
			`${stableStringify(buildManifest("unknown", artifacts))}
`,
		);
		for (const [file, body] of bodies) {
			repo.writeFile(file, body);
		}
		repo.git(["add", ...files]);
		const run = await runLauncher(repo.dir, ["git", "pre-commit"]);
		return `${run.stdout}${run.stderr}`
			.split("\n")
			.filter((line) => line.includes("core/doc-single-owner"))
			.join("\n");
	} finally {
		repo.cleanup();
	}
}

test("[consumer] [§4.9.2] staged manifest-listed regen output raises no doc-single-owner finding (BUG-0117)", async () => {
	assert.equal(await ownerFindings(GENERATED, GENERATED), "");
});

test("[consumer] [§4.9.2] two staged hand-written docs sharing a sentence still raise doc-single-owner (BUG-0117)", async () => {
	const found = await ownerFindings(["docs/a.md", "docs/b.md"], GENERATED);
	assert.ok(found.includes("core/doc-single-owner"), `silent: ${found}`);
});
