// SPEC §4.4.5 check runner: probe, input collection, batched runs, output
// parsing, same-pack rule mapping and tool events. Parse failures, timeouts
// and unlisted codes fail closed; findings carry the pack rule id and never
// quote tool output (§9.2) — the parsed finding message is the verdict
// payload the section designs, not an error leak.

import type { Ports } from "../../../kernel/index.ts";
import {
	err,
	ok,
	type Result,
	stableStringify,
} from "../../../kernel/index.ts";
import type { CheckContext, Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import { field } from "../manifest.ts";
import { bindRule, findingFor, type RuleBinding } from "./binding.ts";
import type { ExternalInput, ExternalOptions, ToolDecl } from "./external.ts";
import {
	closedFinding,
	detailVars,
	type ResolvedExternal,
	runBatch,
} from "./external-attribute.ts";
import { narrowExternalArgs } from "./external-bind.ts";
import { probeToolVersion } from "./external-probe.ts";
import { executeBatch, planRuns } from "./external-runs.ts";

interface CollectedInput {
	readonly files: ReadonlyArray<string>;
	readonly stdin: string | undefined;
}

const OUT_BASE = ".codictator-tool-out";

async function collectInput(
	ports: Ports,
	input: ExternalInput,
	ctx: CheckContext,
): Promise<Result<CollectedInput>> {
	const sorted = [...ctx.scope.files].sort();
	if (input === "staged") {
		const staged = await ports.git.stagedFiles();
		if (!staged.ok) {
			return err(staged.error);
		}
		return ok({ files: [...staged.value].sort(), stdin: undefined });
	}
	if (input === "stdin-json") {
		const payload: Record<string, unknown> =
			ctx.scope.sessionId === undefined
				? { files: sorted }
				: { files: sorted, sessionId: ctx.scope.sessionId };
		return ok({ files: [], stdin: stableStringify(payload) });
	}
	if (input === "diff") {
		return err({
			code: "CDX-E903",
			message:
				"diff input needs base and head revisions the pack does not declare",
			remediation: "Bind the diff range in the pack, then reload.",
		});
	}
	return ok({ files: sorted, stdin: undefined });
}

function buildEnv(ports: Ports, tool: ToolDecl): Record<string, string> {
	const env: Record<string, string> = {};
	for (const name of tool.envPass) {
		const value = ports.env.get(name);
		if (value !== undefined) {
			env[name] = value;
		}
	}
	return env;
}

async function runCheck(
	ports: Ports,
	binding: RuleBinding,
	resolved: ResolvedExternal,
	probeCache: Map<string, string>,
	outSeq: { next: number },
	ctx: CheckContext,
): Promise<Array<Finding>> {
	const probed = await probeToolVersion(ports, resolved.tool, probeCache);
	if (!probed.ok) {
		return [
			closedFinding(
				binding,
				resolved.tool.id,
				probed.error.code,
				`failed its version probe: ${probed.error.message}`,
			),
		];
	}
	const collected = await collectInput(ports, resolved.args.input, ctx);
	if (!collected.ok) {
		return [
			findingFor(binding, {
				code: collected.error.code,
				message: `the guard could not collect its input; the code was not judged`,
				vars: detailVars(resolved.tool.id),
			}),
		];
	}
	const outBase = `${OUT_BASE}-${String(outSeq.next)}`;
	outSeq.next += 1;
	const runs = planRuns(
		resolved.tool,
		resolved.args.input,
		collected.value.files,
		collected.value.stdin,
		outBase,
	);
	const env = buildEnv(ports, resolved.tool);
	const findings: Array<Finding> = [];
	for (const run of runs) {
		const outcome = await executeBatch(ports, {
			argv: run.argv,
			stdin: run.stdin,
			outPath: run.outPath,
			timeoutMs: resolved.timeoutMs,
			env,
		});
		const batch = runBatch(binding, resolved, probed.value, run.argv, outcome);
		findings.push(...batch.findings);
		if (resolved.onToolEvent !== undefined) {
			resolved.onToolEvent(batch.event);
		}
	}
	return findings.sort((a, b) => {
		const pathA = a.path ?? "";
		const pathB = b.path ?? "";
		if (pathA !== pathB) {
			return pathA < pathB ? -1 : 1;
		}
		const lineA = a.line ?? 0;
		const lineB = b.line ?? 0;
		if (lineA !== lineB) {
			return lineA - lineB;
		}
		if (a.message === b.message) {
			return 0;
		}
		return a.message < b.message ? -1 : 1;
	});
}

// SPEC §4.4.3 step 4: one enforcer per referencing rule. The instance keeps
// only the tool findings mapped to its own rule id (the "*" wildcard maps
// every tool finding to it); its siblings keep theirs.
export function resolveExternal(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
	tool: ToolDecl,
	options: ExternalOptions = {},
): Result<Enforcer> {
	const binding = bindRule(rule);
	const args = narrowExternalArgs(decl.id, decl.args);
	if (!args.ok) {
		return err(args.error);
	}
	const ruleMap = decl.ruleMap ?? {};
	const specificRules = Object.keys(ruleMap)
		.filter((toolRule) => ruleMap[toolRule] === rule.id)
		.sort();
	const wildcard = field(ruleMap, "*") === rule.id;
	const probeCache = new Map<string, string>();
	const outSeq = { next: 0 };
	const resolved: ResolvedExternal = {
		tool,
		args: args.value,
		specificRules,
		wildcard,
		timeoutMs: args.value.timeoutMs ?? tool.timeoutMs,
		onToolEvent: options.onToolEvent,
	};
	return ok({
		id: rule.id,
		kinds: binding.triggers,
		budgetMs: decl.budgetMs,
		check: (ctx: CheckContext): Promise<Array<Finding>> =>
			runCheck(ports, binding, resolved, probeCache, outSeq, ctx),
	});
}
