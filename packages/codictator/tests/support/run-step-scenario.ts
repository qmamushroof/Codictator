// Shared builders for the run: step extraction tests (SPEC §4.7.2): workflow
// text from lines, and the dangerous-shell findings over one workflow file.
import { resolveDangerousShell } from "../../src/features/packs/enforcers/shell-analyse.ts";
import type { PackRule } from "../../src/features/packs/index.ts";
import { FIXED_INSTANT } from "./fake-clock.ts";
import { createFakePorts } from "./fake-ports.ts";

export const NL = String.fromCharCode(10);
export const WORKFLOW = ".github/workflows/ci.yml";
export const TAB = String.fromCharCode(9);
export const BACKSLASH = String.fromCharCode(92);

export function yaml(...lines: ReadonlyArray<string>): string {
	return lines.join(NL) + NL;
}

export function ruleFor(): PackRule {
	return {
		id: "core/dangerous-shell",
		family: "F2",
		tier: "floor",
		statement: "s",
		reason: "r",
		remediation: "fix {path}",
		enforcer: "core/dangerous-shell",
		triggers: ["pre-tool"],
		scope: [],
		params: {},
		measureVersion: 1,
		fixtures: { violating: [], passing: [] },
	};
}

export async function findingsFor(text: string): Promise<Array<string>> {
	const fake = createFakePorts();
	fake.fs.seedText(WORKFLOW, text);
	const resolved = resolveDangerousShell(
		{ id: "enf", kind: "code", budgetMs: 1000, args: {} },
		ruleFor(),
		fake.ports,
	);
	const found = await resolved.value.check({
		trigger: "pre-tool",
		scope: { files: [WORKFLOW] },
		now: FIXED_INSTANT,
		configHash: "t",
	});
	return found.map((finding) => finding.message);
}
