// SPEC §4.19.6 step 8: pack-less handoff text. Split from setup.ts
// (orchestration) by responsibility so setup.ts stays below the
// core/file-size 300 cap; the effective pack list mirrors the plan data.
import { BUILTIN_PACK_IDS } from "../features/packs/index.ts";
import { parseJson } from "../kernel/index.ts";
import type { InitFlags } from "./init-plan.ts";
import { readStateText } from "./shared.ts";

// The extension empty-state lives on the vscode branch (§4.20.1);
// handoff here only prints the install command.
export const SETUP_EXTENSION_ID = "codictator.codictator-vscode";
export const SETUP_EXTENSION_INSTALL =
	"code --install-extension codictator.codictator-vscode";

export function setupHandoffLines(emptyPacks: boolean): Array<string> {
	if (!emptyPacks) {
		return [
			"setup complete: open this folder in VS Code to see the Codictator views",
			`extension: ${SETUP_EXTENSION_INSTALL}`,
		];
	}
	// SPEC §4.19.6 step 8: one line per built-in pack id except core, in list
	// order, so a new built-in pack changes the message with no text edit.
	const ids = BUILTIN_PACK_IDS.filter((id) => id !== "core");
	return [
		"Setup complete — core rules only. No language packs installed.",
		"To add a language pack, run the line for your language:",
		...ids.map((id) => `  npx codictator setup --repair --pack ${id}`),
		`Fresh adoption omits --repair: npx codictator setup --pack <${ids.join("|")}>`,
		"To install the VS Code extension, run:",
		`  ${SETUP_EXTENSION_INSTALL}`,
	];
}

// SPEC §4.19.6 step 8: the effective pack list mirrors the plan data:
// explicit --pack flags win, otherwise the written config owns it.
export async function hasEffectivePacks(
	root: string,
	flags: InitFlags,
): Promise<boolean> {
	if (flags.packs.length > 0) {
		return true;
	}
	const text = await readStateText(root, ".codictator/config.json");
	if (text === undefined) {
		return false;
	}
	const parsed = parseJson(text);
	if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) {
		return false;
	}
	const packs = (parsed.value as { packs?: unknown }).packs;
	return Array.isArray(packs) && packs.length > 0;
}
