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
	findingFor,
	type RuleBinding,
	readErrorFinding,
	readLossyText,
	selectFiles,
} from "./binding.ts";
import { plainEnforcer } from "./plain-enforcer.ts";
import { extractShellSources } from "./shell-sources.ts";

export { extractShellSources, isCodeShape } from "./shell-sources.ts";

// SPEC §4.7.2: the L1 hook scope carries the shell command text itself.
// An unparseable command blocks CDX-E306 fail-closed; every deny-class
// match blocks with the command redacted, like the file sources below.
function checkHookCommand(
	binding: RuleBinding,
	scope: CheckContext["scope"],
): Array<Finding> {
	const findings: Array<Finding> = [];
	const command = scope.shellCommand;
	if (command === undefined || command === "") {
		return findings;
	}
	const parsed = analyseShell(command);
	if (!parsed.ok) {
		findings.push(
			findingFor(binding, {
				code: parsed.error.code,
				message: "shell command in tool input is unparseable",
				vars: { path: "tool input" },
			}),
		);
		return findings;
	}
	for (const violation of matchDangerousShell(parsed.value)) {
		findings.push(
			findingFor(binding, {
				message: `${violation.detail} in tool input: ${redactSecrets(violation.raw)}`,
				vars: { path: "tool input" },
			}),
		);
	}
	return findings;
}

export function resolveDangerousShell(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
) {
	return plainEnforcer(decl, rule, (binding) => async (ctx) => {
		const findings: Array<Finding> = checkHookCommand(binding, ctx.scope);
		for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
			const loaded = await readLossyText(ports.fs, file);
			if (!loaded.ok) {
				findings.push(readErrorFinding(binding, file, loaded.error, "read"));
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
	});
}
