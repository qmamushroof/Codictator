// SPEC §4.7.2: target classification for the shell deny checks. A target
// is inside the repo, outside it, or a filesystem root; the per-command
// checkers match their arguments here so each checker stays a thin matcher.
import type { ShellViolation } from "./shell-deny.ts";

export type TargetKind = "inside" | "outside" | "root";

function isHomeRoot(slashed: string): boolean {
	const bracedHome = "$" + "{HOME}";
	return (
		slashed === "~" ||
		slashed.startsWith("~/") ||
		slashed === "$HOME" ||
		slashed.startsWith("$HOME/") ||
		slashed === bracedHome ||
		slashed.startsWith(`${bracedHome}/`) ||
		slashed === "%USERPROFILE%" ||
		slashed.startsWith("%USERPROFILE%/")
	);
}

function rootKindOf(slashed: string): TargetKind | undefined {
	if (isHomeRoot(slashed)) {
		return "root";
	}
	const drive = /^[A-Za-z]:(\/|$)/.exec(slashed);
	if (drive !== null) {
		const rest = slashed.slice(2);
		return rest === "" || rest === "/" ? "root" : "outside";
	}
	if (slashed.startsWith("/") || slashed.startsWith("//")) {
		return slashed === "/" ? "root" : "outside";
	}
	return undefined;
}

function relativeKindOf(slashed: string): TargetKind {
	const kept: Array<string> = [];
	for (const part of slashed.split("/")) {
		if (part === "" || part === ".") {
			continue;
		}
		if (part === "..") {
			if (kept.pop() === undefined) {
				return "outside";
			}
			continue;
		}
		kept.push(part);
	}
	return "inside";
}

export function classifyTarget(target: string): TargetKind {
	if (target === "" || target === "-") {
		return "inside";
	}
	const slashed = target.replace(/\\/g, "/");
	return rootKindOf(slashed) ?? relativeKindOf(slashed);
}

export function flag(
	out: Array<ShellViolation>,
	className: ShellViolation["class"],
	raw: string,
	detail: string,
): void {
	out.push({ class: className, raw, detail });
}
