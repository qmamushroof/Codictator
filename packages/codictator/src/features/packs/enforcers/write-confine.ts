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
import type { Finding } from "../../engine/index.ts";
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
import { extractShellSources, isCodeShape } from "./shell-analyse.ts";

function writeLineTarget(line: string, file: string): string | undefined {
	const trimmed = line.trimStart();
	if (!trimmed.toLowerCase().startsWith("write:")) {
		return undefined;
	}
	const target = trimmed.slice("write:".length).trim();
	return target === "" || isCodeShape(target, file) ? undefined : target;
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

// SPEC §4.7.3: a `write:` line inside code is object syntax
// (`write: "write",` caught via quotes, `(chunk) => ...` caught via `=>`),
// not a tool target. Hyphens, parens, braces, brackets, semicolons, commas,
// and backslash are legal in Windows+POSIX paths (`SN-LP-64`,
// `Program Files (x86)`, `[draft]`, `C:\` absolutes), so treating them as
// code markers misclassifies a real path and fails OPEN by skipping the
// escape check; only characters that real targets rarely carry mark a target
// as code here (the backslash drop un-breaks `C:\` absolutes).
const CODE_CHARS = /[\x22\x27=><|&$\x60]/;

function isPathLike(target: string): boolean {
	return !CODE_CHARS.test(target);
}

async function checkTarget(
	ports: Ports,
	binding: RuleBinding,
	file: string,
	target: string,
	findings: Array<Finding>,
): Promise<void> {
	if (!isPathLike(target)) {
		return;
	}
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

// SPEC §4.7.3 L1: the hook scope carries lexical write targets (the
// tool file path and shell redirection targets), never disk files.
// They judge without a single disk read: realpath on a not-yet-existing
// file would fail benign writes closed, so only the lexical escape
// (EC-1/EC-2 shape) and the .git guard apply. Anything needing the
// filesystem (symlink escapes, EC-9) stays a disk-scope concern.
function checkProposedTarget(
	binding: RuleBinding,
	target: string,
	findings: Array<Finding>,
): void {
	if (!isPathLike(target)) {
		return;
	}
	const rel = toRepoPath(target);
	if (!rel.ok) {
		findings.push(escapeFinding(binding, "tool input", target));
		return;
	}
	if (isGitDirPath(rel.value)) {
		findings.push(
			findingFor(binding, {
				path: "tool input",
				message: `write target inside .git/ is only allowed through git: ${target}`,
				vars: { path: "tool input" },
			}),
		);
	}
}

async function judgeFile(
	binding: RuleBinding,
	ports: Ports,
	file: string,
	findings: Array<Finding>,
): Promise<void> {
	const targets = new Set<string>([file]);
	const loaded = await readLossyText(ports.fs, file);
	if (!loaded.ok) {
		findings.push(readErrorFinding(binding, file, loaded.error, "read"));
		return;
	}
	for (const line of loaded.value.text.split("\n")) {
		const target = writeLineTarget(line, file);
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

export function resolveWriteConfinement(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
) {
	return plainEnforcer(decl, rule, (binding) => async (ctx) => {
		const findings: Array<Finding> = [];
		for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
			await judgeFile(binding, ports, file, findings);
		}
		// L1 hook targets are lexical only: no disk read, so benign
		// writes to not-yet-existing files stay allowed while lexical
		// escapes (EC-8 shape) still block.
		for (const target of [...(ctx.scope.proposedPaths ?? [])].sort()) {
			checkProposedTarget(binding, target, findings);
		}
		return findings;
	});
}
