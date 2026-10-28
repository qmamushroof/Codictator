// SPEC §4.7.3 core/write-confinement: tool.pre.write targets and shell
// redirection targets resolve, through symlinks, to inside the repo root
// or the OS temp dir; otherwise they block. Writes into .git/ are blocked
// except through git itself. Targets arrive as `write:` lines and shell
// sources of the scanned files; the Fs port resolves symlinks, so the
// fixture symlink case blocks with a real root and escapes block lexically.
import {
	analyseShell,
	isGitDirPath,
	type Ports,
	toRepoPath,
} from "../../../kernel/index.ts";
import type { CheckContext, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import {
	bindRule,
	findingFor,
	type RuleBinding,
	readErrorFinding,
	readLossyText,
	selectFiles,
} from "./binding.ts";
import { extractShellSources } from "./shell-analyse.ts";

function writeLineTarget(line: string): string | undefined {
	const trimmed = line.trimStart();
	if (!trimmed.toLowerCase().startsWith("write:")) {
		return undefined;
	}
	const target = trimmed.slice("write:".length).trim();
	return target === "" ? undefined : target;
}

function escapeFinding(
	binding: RuleBinding,
	file: string,
	target: string,
): Finding {
	return findingFor(binding, {
		path: file,
		code: "CDX-E701",
		message: `write target escapes the repo root: ${target}`,
		vars: { path: file },
	});
}

async function checkTarget(
	ports: Ports,
	binding: RuleBinding,
	file: string,
	target: string,
	findings: Array<Finding>,
): Promise<void> {
	const rel = toRepoPath(target);
	if (!rel.ok) {
		findings.push(escapeFinding(binding, file, target));
		return;
	}
	if (isGitDirPath(rel.value)) {
		findings.push(
			findingFor(binding, {
				path: file,
				message: `write target inside .git/ is only allowed through git: ${target}`,
				vars: { path: file },
			}),
		);
		return;
	}
	const real = await ports.fs.realpath(target);
	if (!real.ok) {
		if (real.error.code === "CDX-E701") {
			findings.push(escapeFinding(binding, file, target));
			return;
		}
		findings.push(readErrorFinding(binding, target, real.error, "resolve"));
		return;
	}
}

export function resolveWriteConfinement(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
) {
	const binding: RuleBinding = bindRule(rule);
	return {
		ok: true as const,
		value: {
			id: rule.id,
			kinds: binding.triggers,
			budgetMs: decl.budgetMs,
			check: async (ctx: CheckContext): Promise<Array<Finding>> => {
				const findings: Array<Finding> = [];
				for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
					const targets = new Set<string>([file]);
					const loaded = await readLossyText(ports.fs, file);
					if (!loaded.ok) {
						findings.push(
							readErrorFinding(binding, file, loaded.error, "read"),
						);
						continue;
					}
					for (const line of loaded.value.text.split("\n")) {
						const target = writeLineTarget(line);
						if (target !== undefined) {
							targets.add(target);
						}
					}
					for (const source of extractShellSources(loaded.value.text, file)) {
						const parsed = analyseShell(source);
						if (!parsed.ok) {
							continue;
						}
						for (const target of parsed.value.writeTargets) {
							targets.add(target);
						}
					}
					for (const target of [...targets].sort()) {
						await checkTarget(ports, binding, file, target, findings);
					}
				}
				return findings;
			},
		},
	};
}
