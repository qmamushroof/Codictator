// SPEC §4.20.1: the extension entry (a dist/extension.cjs shim plus
// dist/main.js) lands with the extension phase; this stub exposes the package
// id meanwhile so the package has a compiled input.
export const extensionId: string = "codictator-vscode";

export interface RuleGroup {
	readonly pack: string;
	readonly rules: ReadonlyArray<string>;
}

// SPEC §4.20.2: active rules view data (packs, tiers, bounds) over stdio.
export function listRuleGroups(
	_folders: ReadonlyArray<string>,
): Promise<Array<RuleGroup>> {
	throw new Error("not implemented: SPEC §4.20.2");
}

// SPEC §4.20.2: violations view diagnostics with rule id and remediation.
export function refreshViolationDiagnostics(_folder: string): Promise<number> {
	throw new Error("not implemented: SPEC §4.20.2");
}

// SPEC §4.20.2 L2 on save: verify the file, never block the save.
export function verifyFileOnSave(
	_folder: string,
	_file: string,
): Promise<string> {
	throw new Error("not implemented: SPEC §4.20.2");
}

// SPEC §4.20.3: a human-only command opens a terminal pre-filled with it.
export function runHumanOnlyCommand(_command: string): Promise<string> {
	throw new Error("not implemented: SPEC §4.20.3");
}
