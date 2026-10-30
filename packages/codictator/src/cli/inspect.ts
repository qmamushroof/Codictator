// SPEC §4.14.2 + §4.18.3 + §4.19.2: verify and status. Verify evaluates
// the manifest drift and blocks on findings; status renders the
// agent-readable screen (or --json for the extension).
import { parseArgs } from "node:util";
import type { Finding, Result } from "../kernel/index.ts";
import { ok } from "../kernel/index.ts";
import { driftFindings } from "./drift.ts";
import { evaluateScope, resolveVerifyScope } from "./evaluate.ts";
import type { CommandRequest } from "./shared.ts";
import {
	fail,
	loadRepoConfig,
	needRoot,
	printHuman,
	printJson,
	usageError,
} from "./shared.ts";

export function printFinding(finding: Finding, quiet: boolean): void {
	const where =
		finding.path === undefined
			? ""
			: `  ${finding.path}${finding.line === undefined ? "" : `:${finding.line}`}`;
	printHuman(`${finding.ruleId}${where}  ${finding.message}`, quiet);
	printHuman(`Do instead: ${finding.remediation}`, quiet);
}

const LAYERS: ReadonlySet<string> = new Set(["L1", "L2", "L3", "L4", "L5"]);

interface VerifyFlags {
	readonly staged: boolean;
	readonly all: boolean;
	readonly base: string | undefined;
	readonly head: string | undefined;
	readonly layer: string | undefined;
}

function parseVerifyFlags(
	args: ReadonlyArray<string>,
): VerifyFlags | undefined {
	try {
		const parsed = parseArgs({
			args: [...args],
			options: {
				staged: { type: "boolean", default: false },
				all: { type: "boolean", default: false },
				base: { type: "string" },
				head: { type: "string" },
				layer: { type: "string" },
			},
			allowPositionals: true,
		});
		if (parsed.positionals.length > 0) {
			return undefined;
		}
		if (parsed.values.layer !== undefined && !LAYERS.has(parsed.values.layer)) {
			return undefined;
		}
		if (
			(parsed.values.base === undefined) !==
			(parsed.values.head === undefined)
		) {
			return undefined;
		}
		return {
			staged: parsed.values.staged ?? false,
			all: parsed.values.all ?? false,
			base: parsed.values.base,
			head: parsed.values.head,
			layer: parsed.values.layer,
		};
	} catch {
		return undefined;
	}
}

function emitVerify(
	req: CommandRequest,
	findings: ReadonlyArray<Finding>,
	configHash: string,
	note: string,
): Result<number> {
	if (req.json) {
		printJson({
			decision: findings.length === 0 ? "allow" : "block",
			findings,
			configHash,
			note,
		});
	} else {
		for (const finding of findings) {
			printFinding(finding, req.quiet);
		}
		if (findings.length === 0) {
			printHuman(`verify: pass (${note})`, req.quiet);
		}
	}
	return findings.length === 0 ? ok(0) : ok(1);
}

// SPEC §4.19.2: evaluate a trigger scope; findings block (exit 1), an
// advise-only or clean run passes (exit 0).
export async function handleVerify(
	req: CommandRequest,
): Promise<Result<number>> {
	const flags = parseVerifyFlags(req.args);
	if (flags === undefined) {
		return usageError(
			"usage: codictator verify [--staged | --base <ref> --head <ref> | --all] [--layer L1..L5]",
		);
	}
	const root = await needRoot(req);
	if (typeof root !== "string") {
		return root;
	}
	const configured = await loadRepoConfig(root);
	if (!configured.ok) {
		return fail(
			configured.error.code,
			configured.error.message,
			"Fix .codictator/config.json, then retry.",
			req.json,
		);
	}
	const drifted = await driftFindings(root, flags.layer);
	const scoped = await resolveVerifyScope(configured.value.ports, flags);
	if (!scoped.ok) {
		return fail(
			scoped.error.code,
			scoped.error.message,
			scoped.error.remediation,
			req.json,
		);
	}
	const evaluated = await evaluateScope(
		configured.value.ports,
		configured.value.effective.config.packs.map((entry) => entry.id),
		scoped.value,
		configured.value.ports.clock.now(),
		configured.value.effective.configHash,
	);
	if (!evaluated.ok) {
		return fail(
			evaluated.error.code,
			evaluated.error.message,
			evaluated.error.remediation,
			req.json,
		);
	}
	return emitVerify(
		req,
		[...drifted.findings, ...evaluated.value],
		configured.value.effective.configHash,
		`${drifted.note}; ${scoped.value.note}`,
	);
}

export { handleStatus, readLogEvents } from "./inspect-status.ts";
