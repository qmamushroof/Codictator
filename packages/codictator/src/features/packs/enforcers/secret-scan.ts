// SPEC §4.7.1 core/no-secrets and core/no-secret-reads: the kernel
// detectors bound to the rules. no-secrets scans every scoped file with
// redactSecrets, skipping fixture globs; no-secret-reads blocks secret
// paths themselves and `read:` lines naming one, plus secret reads inside
// shell sources. Findings carry the rule id the self-test asserts.
import {
	analyseShell,
	isFixturePath,
	isSecretReadPath,
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
import { extractShellSources } from "./shell-analyse.ts";

function firstDiffLine(before: string, after: string): number {
	const beforeLines = before.split("\n");
	const afterLines = after.split("\n");
	const total = Math.max(beforeLines.length, afterLines.length);
	for (let line = 1; line <= total; line += 1) {
		if (beforeLines[line - 1] !== afterLines[line - 1]) {
			return line;
		}
	}
	return 1;
}

function excerpt(text: string, line: number): string {
	const found = text.split("\n")[line - 1] ?? text.split("\n")[0] ?? "";
	return found.length > 200 ? `${found.slice(0, 200)}…` : found;
}

function secretFinding(
	binding: RuleBinding,
	file: string,
	text: string,
	redacted: string,
): Finding {
	const line = firstDiffLine(text, redacted);
	return findingFor(binding, {
		path: file,
		line,
		message: `secret detected in ${file}: ${excerpt(redacted, line)}`,
		vars: { path: file, line: String(line) },
	});
}

export function resolveNoSecrets(
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
					if (isFixturePath(file)) {
						continue;
					}
					const loaded = await readLossyText(ports.fs, file);
					if (!loaded.ok) {
						findings.push(
							readErrorFinding(binding, file, loaded.error, "read"),
						);
						continue;
					}
					const redacted = redactSecrets(loaded.value.text);
					if (redacted !== loaded.value.text) {
						findings.push(
							secretFinding(binding, file, loaded.value.text, redacted),
						);
					}
				}
				return findings;
			},
		},
	};
}

function readLineTarget(line: string): string | undefined {
	const trimmed = line.trimStart();
	if (!trimmed.toLowerCase().startsWith("read:")) {
		return undefined;
	}
	const target = trimmed.slice("read:".length).trim();
	return target === "" ? undefined : target;
}

export function resolveNoSecretReads(
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
					if (isSecretReadPath(file)) {
						findings.push(
							findingFor(binding, {
								path: file,
								message: `secret material must not reach the agent context: ${file}`,
								vars: { path: file },
							}),
						);
					}
					const loaded = await readLossyText(ports.fs, file);
					if (!loaded.ok) {
						findings.push(
							readErrorFinding(binding, file, loaded.error, "read"),
						);
						continue;
					}
					for (const line of loaded.value.text.split("\n")) {
						const target = readLineTarget(line);
						if (target !== undefined && isSecretReadPath(target)) {
							findings.push(
								findingFor(binding, {
									path: file,
									message: `secret material must not reach the agent context: ${target}`,
									vars: { path: file },
								}),
							);
						}
					}
					for (const source of extractShellSources(loaded.value.text, file)) {
						const parsed = analyseShell(source);
						if (!parsed.ok) {
							continue;
						}
						for (const violation of matchDangerousShell(parsed.value)) {
							if (violation.class !== "secret-read") {
								continue;
							}
							findings.push(
								findingFor(binding, {
									path: file,
									message: `shell command reads secret material in ${file}: ${redactSecrets(violation.raw)}`,
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
