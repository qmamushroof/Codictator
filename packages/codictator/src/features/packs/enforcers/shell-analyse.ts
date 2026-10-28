// SPEC §4.7.2 core/dangerous-shell: the kernel shell analyser bound to
// the rule. Shell text arrives as `run:` lines of the scanned files (the
// hook runtime feeds tool commands this way); whole files with a shell
// extension are analysed as scripts. Findings carry the rule id the
// self-test asserts (CDX-E212/E213).
import {
	analyseShell,
	matchDangerousShell,
	type Ports,
	redactSecrets,
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

const SCRIPT_EXTENSIONS: ReadonlyArray<string> = [
	".sh",
	".bash",
	".zsh",
	".ksh",
	".ps1",
	".cmd",
	".bat",
];

function isScriptFile(path: string): boolean {
	const lowered = path.toLowerCase();
	return SCRIPT_EXTENSIONS.some((extension) => lowered.endsWith(extension));
}

// SPEC §4.7.2: one shell source per `run:` line, or the whole file for a
// shell script. Other files carry no shell text, so they yield nothing.
export function extractShellSources(
	content: string,
	path: string,
): Array<string> {
	if (isScriptFile(path)) {
		return content.length === 0 ? [] : [content];
	}
	const sources: Array<string> = [];
	for (const line of content.split("\n")) {
		const trimmed = line.trimStart();
		if (trimmed.toLowerCase().startsWith("run:")) {
			const command = trimmed.slice("run:".length).trim();
			if (command !== "") {
				sources.push(command);
			}
		}
	}
	return sources;
}

export function resolveDangerousShell(
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
			check: async (ctx: CheckContext) => {
				const findings: Array<Finding> = [];
				for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
					const loaded = await readLossyText(ports.fs, file);
					if (!loaded.ok) {
						findings.push(
							readErrorFinding(binding, file, loaded.error, "read"),
						);
						continue;
					}
					for (const source of extractShellSources(loaded.value.text, file)) {
						const parsed = analyseShell(source);
						if (!parsed.ok) {
							findings.push(
								findingFor(binding, {
									path: file,
									code: parsed.error.code,
									message: `shell command in ${file} is unparseable`,
									vars: { path: file },
								}),
							);
							continue;
						}
						for (const violation of matchDangerousShell(parsed.value)) {
							findings.push(
								findingFor(binding, {
									path: file,
									message: `${violation.detail} in ${file}: ${redactSecrets(violation.raw)}`,
									vars: { path: file },
								}),
							);
						}
					}
				}
				return findings;
			},
		},
	};
}
