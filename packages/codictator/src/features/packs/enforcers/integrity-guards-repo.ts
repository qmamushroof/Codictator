// SPEC §4.14.2/§4.14.3 + §5.11: repo-integrity enforcers. Split from the
// test-integrity guards (integrity-guards) by responsibility: hook bypass
// and committed hygiene here, test vectors there.
import {
	analyseShell,
	isProtectedPath,
	matchBypassCommand,
	ok,
	type Ports,
	type Result,
	type SimpleCommand,
	scanBypassRawText,
} from "../../../kernel/index.ts";
import type { CheckContext, Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import { bindRule, findingFor, type RuleBinding } from "./binding.ts";
import { baseEnforcer, scopeMarkerTexts } from "./health-measures.ts";

// SPEC §4.14.3 command table: the shells whose bare remainder is a command
// of its own. A bare `bash git commit -n` parses as one argv, so the text
// past the shell name is evaluated as its own candidate, the text form of
// checkSelfProtection's argv candidates (self-protection.ts).
const BARE_SHELLS = new Set([
	"bash",
	"sh",
	"dash",
	"zsh",
	"env",
	"sudo",
	"doas",
]);

function bareRemainder(cmd: SimpleCommand): string | undefined {
	const lowered =
		cmd.name.replaceAll("\\", "/").split("/").pop()?.toLowerCase() ?? "";
	if (!BARE_SHELLS.has(lowered)) {
		return undefined;
	}
	if (cmd.argv.includes("-c") || cmd.argv.includes("--command")) {
		return undefined;
	}
	return cmd.argv.length > 0 ? cmd.argv.join(" ") : undefined;
}

// SPEC §4.7.2: wrappers do not hide bypasses, so one shell text fans out to
// its payloads: the -c/--command scripts and bare-shell remainders the
// analyser collected, transitively. Unparseable candidates are skipped
// here; the caller blocks them fail-closed instead of allowing.
function shellCandidates(text: string): Array<string> {
	const seen = new Set<string>([text]);
	const out = [text];
	const queue = [text];
	while (queue.length > 0) {
		const current = queue.pop() ?? "";
		const parsed = analyseShell(current);
		if (!parsed.ok) {
			continue;
		}
		for (const pipeline of parsed.value.pipelines) {
			for (const cmd of pipeline.commands) {
				const extras: Array<string | undefined> = [
					...cmd.embedded,
					bareRemainder(cmd),
				];
				for (const extra of extras) {
					if (extra !== undefined && extra !== "" && !seen.has(extra)) {
						seen.add(extra);
						out.push(extra);
						queue.push(extra);
					}
				}
			}
		}
	}
	return out;
}

function firstWord(text: string): string {
	const trimmed = text.trimStart();
	const space = trimmed.search(/\s/);
	return space < 0 ? trimmed : trimmed.slice(0, space);
}

function unparseableFinding(): Finding {
	return {
		ruleId: "core/dangerous-shell",
		code: "CDX-E306",
		message: "shell command in tool input is unparseable",
		remediation: "Rewrite the command with balanced quotes and retry (§4.7.2).",
	};
}

// SPEC §4.14.3 L1: the shellCommand text is judged like checkSelfProtection
// judges argv — structured match first, raw-text backstop second (env-prefix
// stripping hides HUSKY=0 from the parse, so the raw scan stays).
function checkShellCommand(
	binding: RuleBinding,
	command: string,
): Array<Finding> {
	const findings: Array<Finding> = [];
	for (const candidate of shellCandidates(command)) {
		const parsed = analyseShell(candidate);
		if (!parsed.ok) {
			continue;
		}
		for (const pipeline of parsed.value.pipelines) {
			for (const cmd of pipeline.commands) {
				const hit = matchBypassCommand(cmd);
				if (hit !== undefined) {
					findings.push(
						findingFor(binding, {
							message: `${hit} in tool input`,
							vars: { path: "tool input" },
						}),
					);
					return findings;
				}
			}
		}
	}
	const raw = scanBypassRawText(command);
	if (raw !== undefined) {
		findings.push(
			findingFor(binding, {
				message: `${raw} in tool input`,
				vars: { path: "tool input" },
			}),
		);
	}
	return findings;
}

// SPEC §4.14.3 target rows: a tool-form write carries proposed content, so
// the lexical proposed paths are write targets and guardrail paths block.
// Reads carry no content and stay allowed; L0 still reads guardrail state.
function checkProposedWrites(
	binding: RuleBinding,
	scope: CheckContext["scope"],
): Array<Finding> {
	const findings: Array<Finding> = [];
	if (scope.proposedContent === undefined) {
		return findings;
	}
	for (const target of [...(scope.proposedPaths ?? [])].sort()) {
		if (isProtectedPath(target)) {
			findings.push(
				findingFor(binding, {
					path: target,
					message: `agent write of protected guardrail path ${target}`,
					vars: { path: target },
				}),
			);
		}
	}
	return findings;
}

// SPEC §4.14.3 L1: the live hook scope carries the one tool call, so the
// enforcer judges it alongside the marker report. Parse failure alone never
// becomes an allow: an unparseable shell-looking command blocks CDX-E306.
function checkLiveBypass(
	binding: RuleBinding,
	ctx: CheckContext,
): Array<Finding> {
	const findings = checkProposedWrites(binding, ctx.scope);
	const command = ctx.scope.shellCommand;
	if (command === undefined || command === "") {
		return findings;
	}
	findings.push(...checkShellCommand(binding, command));
	if (!analyseShell(command).ok) {
		const head = firstWord(command).toLowerCase();
		if (BARE_SHELLS.has(head) || /[;|&$`()]/.test(command)) {
			findings.push(unparseableFinding());
		}
	}
	return findings;
}

// SPEC §4.14.2/§4.14.3 core/no-bypass: the live L1 command shapes above,
// plus a commit that skips the hooks (--no-verify) flags at L4. The marker
// mirror below answers from the case report.
export function resolveNoBypass(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const { file, markers } of await scopeMarkerTexts(
				ports,
				binding,
				ctx,
				findings,
			)) {
				if ((markers.get("commit") ?? "").includes("--no-verify")) {
					findings.push(
						findingFor(binding, {
							path: file,
							message: "commit skips the hooks with --no-verify",
							vars: { path: file },
						}),
					);
				}
			}
			findings.push(...checkLiveBypass(binding, ctx));
			return findings;
		}),
	);
}

// SPEC §5.11 core/repo-hygiene: committed build output or caches flag. The
// .gitattributes and root-allowlist reads stay in the integrity module;
// the marker mirror judges only the reported committed paths, matched on
// whole segments so src/dist-info stays quiet.
const OUTPUT_DIR_PATTERN =
	/(^|\/)(node_modules|dist|build|bin|obj|__pycache__|\.venv|coverage)(\/|$)/i;

export function resolveRepoHygiene(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	const binding = bindRule(rule);
	return ok(
		baseEnforcer(rule, binding, decl, async (ctx) => {
			const findings: Array<Finding> = [];
			for (const { file, markers } of await scopeMarkerTexts(
				ports,
				binding,
				ctx,
				findings,
			)) {
				const committed = (markers.get("committed") ?? "")
					.split(",")
					.map((entry) => entry.trim())
					.filter((entry) => entry !== "");
				const bad = committed.find((entry) => OUTPUT_DIR_PATTERN.test(entry));
				if (bad !== undefined) {
					findings.push(
						findingFor(binding, {
							path: file,
							message: `committed build output or cache: ${bad}`,
							vars: { path: bad },
						}),
					);
				}
			}
			return findings;
		}),
	);
}
