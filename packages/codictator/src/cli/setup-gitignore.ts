// SPEC §7.1: the manifest-owned .gitignore entries. setup guarantees them
// on disk; the manifest never lists .gitignore, so regen stays drift-free.
import type { Result } from "../kernel/index.ts";
import { err, ok } from "../kernel/index.ts";
import type { SetupStep } from "./setup.ts";
import type { CommandRequest } from "./shared.ts";
import { fail, printHuman, readStateText, writeStateText } from "./shared.ts";

const SETUP_GITIGNORE_ENTRIES: ReadonlyArray<string> = [
	".codictator/state/",
	".codictator/cache/",
	".codictator/tool/node_modules/",
];

export async function ensureGitignoreEntries(
	root: string,
): Promise<Result<{ added: Array<string> }>> {
	const existing = await readStateText(root, ".gitignore");
	const present = new Set(
		(existing ?? "").split("\n").map((line) => line.trim()),
	);
	const missing = SETUP_GITIGNORE_ENTRIES.filter(
		(entry) => !present.has(entry),
	);
	if (missing.length === 0) {
		return ok({ added: [] });
	}
	const base =
		existing === undefined || existing === ""
			? ""
			: existing.endsWith("\n")
				? existing
				: `${existing}\n`;
	const saved = await writeStateText(
		root,
		".gitignore",
		`${base}${missing.join("\n")}\n`,
	);
	if (!saved.ok) {
		return err(saved.error);
	}
	return ok({ added: [...missing] });
}

// SPEC §4.19.6 step 3: guarantee the manifest-owned .gitignore entries.
export async function setupGitignoreStep(
	req: CommandRequest,
	root: string,
	steps: Array<SetupStep>,
): Promise<Result<number>> {
	const ensured = await ensureGitignoreEntries(root);
	if (!ensured.ok) {
		return fail(
			"CDX-E903",
			ensured.error.message,
			ensured.error.remediation,
			req.json,
		);
	}
	steps.push({
		step: "gitignore",
		ok: true,
		detail: { added: ensured.value.added },
	});
	if (ensured.value.added.length > 0) {
		printHuman(
			`setup: added ${String(ensured.value.added.length)} .gitignore entries`,
			req.quiet,
		);
	}
	return ok(0);
}
