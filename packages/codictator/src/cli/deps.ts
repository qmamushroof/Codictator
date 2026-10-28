// SPEC §4.8 + §4.13.1: offline dependency analysis over manifests and
// lockfiles; registry data needs a snapshot or the network (CDX-E401).
import { parseArgs } from "node:util";
import { detectBrownfield } from "../features/remediation/index.ts";
import type { Result } from "../kernel/index.ts";
import { ok } from "../kernel/index.ts";
import { printFinding } from "./inspect.ts";
import type { CommandRequest } from "./shared.ts";
import {
	fail,
	needRoot,
	portsFor,
	printHuman,
	printJson,
	readStateText,
	usageError,
} from "./shared.ts";

interface ManifestInputs {
	readonly paths: ReadonlyArray<string>;
	readonly texts: ReadonlyArray<{ path: string; text: string }>;
	readonly lockfiles: Record<string, string | null>;
}

async function collectManifests(
	root: string,
): Promise<ManifestInputs | undefined> {
	const ports = await portsFor(root);
	if (!ports.ok) {
		return undefined;
	}
	const found = await ports.value.fs.glob("package.json", ".");
	const manifests = found.ok ? found.value : [];
	const texts: Array<{ path: string; text: string }> = [];
	for (const manifest of manifests.slice(0, 20)) {
		const seen = await ports.value.fs.exists(manifest);
		if (!seen.ok || !seen.value) {
			continue;
		}
		const text = await ports.value.fs.readText(manifest);
		if (text.ok) {
			texts.push({ path: manifest, text: text.value });
		}
	}
	if (texts.length === 0) {
		return undefined;
	}
	const lockfiles: Record<string, string | null> = {};
	for (const input of texts) {
		const lock = input.path.replace(/package\.json$/, "package-lock.json");
		lockfiles[input.path] = (await readStateText(root, lock)) ?? null;
	}
	return { paths: texts.map((input) => input.path), texts, lockfiles };
}

async function depsCheck(
	req: CommandRequest,
	root: string,
	now: string,
): Promise<Result<number>> {
	const inputs = await collectManifests(root);
	if (inputs === undefined) {
		return fail(
			"CDX-E903",
			"no package manifests found",
			"Run in a repo with manifests, then retry.",
			req.json,
		);
	}
	const detection = detectBrownfield({
		files: inputs.paths,
		manifests: inputs.texts,
		lockfiles: inputs.lockfiles,
		now,
	});
	if (req.json) {
		printJson({ findings: detection.findings, loosePins: detection.loosePins });
	} else {
		for (const finding of detection.findings) {
			printFinding(finding, req.quiet);
		}
		if (detection.findings.length === 0) {
			printHuman("deps: no loose pins or missing lockfiles", req.quiet);
		}
	}
	return detection.findings.length === 0 ? ok(0) : ok(1);
}

async function depsUpgrade(
	req: CommandRequest,
	root: string,
	now: string,
): Promise<Result<number>> {
	let pr = false;
	try {
		const parsed = parseArgs({
			args: [...req.args.slice(1)],
			options: { pr: { type: "boolean", default: false } },
			allowPositionals: true,
		});
		if (parsed.positionals.length > 0) {
			return usageError("usage: codictator deps upgrade [--pr]");
		}
		pr = parsed.values.pr ?? false;
	} catch {
		return usageError("usage: codictator deps upgrade [--pr]");
	}
	const inputs = await collectManifests(root);
	if (inputs === undefined) {
		return fail(
			"CDX-E903",
			"no package manifests found",
			"Run in a repo with manifests, then retry.",
			req.json,
		);
	}
	const snapshot = await readStateText(
		root,
		".codictator/registry-snapshot.json",
	);
	if (snapshot === undefined) {
		return fail(
			"CDX-E401",
			"registry data unavailable and no usable snapshot",
			"Retry with network access, or record .codictator/registry-snapshot.json first.",
			req.json,
		);
	}
	const detection = detectBrownfield({
		files: inputs.paths,
		manifests: inputs.texts,
		lockfiles: inputs.lockfiles,
		now,
	});
	if (req.json) {
		printJson({ planned: detection.loosePins.length, pr });
	} else {
		printHuman(
			`deps upgrade planned for ${detection.loosePins.length} loose pin(s)${pr ? " with --pr" : ""}`,
			req.quiet,
		);
	}
	return ok(0);
}

export async function handleDeps(req: CommandRequest): Promise<Result<number>> {
	const sub = req.args[0] ?? "";
	if (sub !== "check" && sub !== "upgrade") {
		return usageError("usage: codictator deps <check|upgrade [--pr]>");
	}
	const root = await needRoot(req);
	if (typeof root !== "string") {
		return root;
	}
	const ports = await portsFor(root);
	if (!ports.ok) {
		return fail(
			"CDX-E903",
			ports.error.message,
			ports.error.remediation,
			req.json,
		);
	}
	const now = ports.value.clock.now();
	return sub === "check"
		? depsCheck(req, root, now)
		: depsUpgrade(req, root, now);
}
