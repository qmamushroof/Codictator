// SPEC §4.14.2 core/engine-version-match: the declared version must equal
// the installed engine; a pack ahead of the engine flags. Split from
// gate-guards.ts by responsibility: pack/engine version equality lives
// here; the marker-threshold guards stay there.
import type { Ports } from "../../../kernel/index.ts";
import { parseJson, type Result } from "../../../kernel/index.ts";
import type { CheckContext, Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import {
	findingFor,
	type RuleBinding,
	readErrorFinding,
	selectFiles,
} from "./binding.ts";
import { checkEnforcer, loadScopeText } from "./health-measures.ts";

async function checkEngineVersionFile(
	ports: Ports,
	binding: RuleBinding,
	file: string,
	findings: Array<Finding>,
): Promise<void> {
	const text = await loadScopeText(ports, binding, file, findings);
	if (text === undefined) {
		return;
	}
	const parsed = parseJson(text);
	if (!parsed.ok) {
		findings.push(readErrorFinding(binding, file, parsed.error, "parse"));
		return;
	}
	const record = (
		typeof parsed.value === "object" && parsed.value !== null
			? parsed.value
			: {}
	) as { readonly engine?: unknown; readonly pack?: unknown };
	if (
		typeof record.engine !== "string" ||
		typeof record.pack !== "string" ||
		record.engine === record.pack
	) {
		return;
	}
	findings.push(
		findingFor(binding, {
			path: file,
			message: `pack version ${record.pack} does not match the engine ${record.engine}`,
			vars: { path: file, value: record.engine },
		}),
	);
}

async function checkEngineVersionFiles(
	ports: Ports,
	binding: RuleBinding,
	ctx: CheckContext,
): Promise<Array<Finding>> {
	const findings: Array<Finding> = [];
	for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
		if (file !== "engine.json" && !file.endsWith("/engine.json")) {
			continue;
		}
		await checkEngineVersionFile(ports, binding, file, findings);
	}
	return findings;
}

// SPEC §4.14.2 core/engine-version-match: the declared version must equal
// the installed engine; a pack ahead of the engine flags.
export function resolveEngineVersionMatch(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return checkEnforcer(decl, rule, (binding, ctx) =>
		checkEngineVersionFiles(ports, binding, ctx),
	);
}
