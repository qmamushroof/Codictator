// SPEC §4.7: secret, shell and path enforcers. The detectors live in the
// kernel (§4.1.2, shell.ts, secret-paths.ts) so every module can use them
// without importing this one (§3.3); this module shapes them into findings
// for direct callers. Pack enforcers bind the same kernel analysers to
// rule ids through the registry (phase 5).
import {
	analyseShell,
	isFixturePath,
	isGitDirPath,
	isSecretReadPath,
	matchDangerousShell,
	redactSecrets,
	toRepoPath,
} from "../../kernel/index.ts";
import type { CheckContext, Finding } from "../engine/index.ts";

export interface SecretMatch {
	readonly kind: string;
	readonly path: string;
	readonly line: number;
	readonly redacted: string;
}

const NO_SECRETS_RULE = "core/no-secrets";
const NO_SECRET_READS_RULE = "core/no-secret-reads";
const DANGEROUS_SHELL_RULE = "core/dangerous-shell";
const WRITE_CONFINEMENT_RULE = "core/write-confinement";

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

// SPEC §4.7.1: secret detection over proposed content. Scope by trigger:
// L1 proposed write content and shell command text, L3 staged content, L4
// every added line in base..head and every commit message in range. Files
// under a fixture glob are test vectors and stay silent; every other match
// is redacted to its first 4 characters plus length (§9.2).
export function checkSecrets(
	ctx: CheckContext,
	content: string,
): Array<Finding> {
	const redacted = redactSecrets(content);
	if (redacted === content) {
		return [];
	}
	const files = [...ctx.scope.files].sort();
	const targets = files.filter((file) => !isFixturePath(file));
	if (files.length > 0 && targets.length === 0) {
		return [];
	}
	const line = firstDiffLine(content, redacted);
	const shown = excerpt(redacted, line);
	if (targets.length === 0) {
		return [
			{
				ruleId: NO_SECRETS_RULE,
				line,
				message: `secret detected in tool input: ${shown}`,
				remediation:
					"Amend the unpushed message or rotate the key; never commit the value.",
			},
		];
	}
	return targets.map((file) => ({
		ruleId: NO_SECRETS_RULE,
		path: file,
		line,
		message: `secret detected in ${file}: ${shown}`,
		remediation:
			"Read it from an env var; add the name, without a value, to .env.example.",
	}));
}

// SPEC §4.7.2: shell command analysis through the kernel analyser. An
// unparseable command blocks CDX-E306 fail-closed; every deny-class match
// blocks with the offending command redacted (§9.2, shell text can carry a
// secret at L1).
export function checkShell(
	_ctx: CheckContext,
	command: string,
): Array<Finding> {
	const parsed = analyseShell(command);
	if (!parsed.ok) {
		return [
			{
				ruleId: DANGEROUS_SHELL_RULE,
				code: parsed.error.code,
				message: `shell command is unparseable: ${parsed.error.message}`,
				remediation: parsed.error.remediation,
			},
		];
	}
	return matchDangerousShell(parsed.value).map((violation) => ({
		ruleId: DANGEROUS_SHELL_RULE,
		message: `${violation.detail}: ${redactSecrets(violation.raw)}`,
		remediation: "Rewrite the command without the blocked construct.",
	}));
}

// SPEC §4.7.3: write confinement to the repo root. A target fails when it
// resolves outside the repo root (CDX-E701), lands inside .git/ except
// through git, or was never declared in the tool scope: an undeclared
// target can traverse a symlink the guard cannot see (EC-9), so it blocks
// fail-closed. Symlink resolution itself needs the Fs port and runs in the
// write-confinement pack enforcer.
export function checkPaths(
	ctx: CheckContext,
	paths: ReadonlyArray<string>,
): Array<Finding> {
	const declared = new Set<string>();
	for (const file of ctx.scope.files) {
		const rel = toRepoPath(file);
		if (rel.ok) {
			declared.add(rel.value);
		}
	}
	const findings: Array<Finding> = [];
	for (const path of [...paths].sort()) {
		const rel = toRepoPath(path);
		if (!rel.ok) {
			findings.push({
				ruleId: WRITE_CONFINEMENT_RULE,
				path,
				code: rel.error.code,
				message: `write target escapes the repo root: ${path}`,
				remediation: `Move the write target under the repo root: ${path}.`,
			});
			continue;
		}
		if (isGitDirPath(rel.value)) {
			findings.push({
				ruleId: WRITE_CONFINEMENT_RULE,
				path,
				message: `write target inside .git/ is only allowed through git: ${path}`,
				remediation: `Move the write target under the repo root: ${path}.`,
			});
			continue;
		}
		if (!declared.has(rel.value)) {
			findings.push({
				ruleId: WRITE_CONFINEMENT_RULE,
				path,
				message: `write target outside the declared tool scope: ${path}`,
				remediation: `Move the write target under the repo root: ${path}.`,
			});
		}
	}
	return findings;
}

// SPEC §4.7.1 secret-read guard over a tool read path: the secret-path
// predicate from the kernel, shaped into the no-secret-reads finding.
export function secretReadFinding(path: string): Finding {
	return {
		ruleId: NO_SECRET_READS_RULE,
		path,
		message: `secret material must not reach the agent context: ${path}`,
		remediation: `Stop reading ${path} and revoke the exposed value.`,
	};
}

export function isSecretPath(path: string): boolean {
	return isSecretReadPath(path);
}
