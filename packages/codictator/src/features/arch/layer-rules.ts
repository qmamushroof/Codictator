// SPEC §4.11.1: folder names are configurable, the direction is not. A layer
// maps to the lower layers plus kernel it may import.
import type { ArchProfile } from "./arch-profiles.ts";

const APP_LAYER_ORDER: Readonly<Record<string, ReadonlyArray<string>>> = {
	domain: ["domain"],
	application: ["domain", "application"],
	infrastructure: ["domain", "application", "infrastructure"],
	ui: ["domain", "application", "ui"],
	api: ["domain", "application", "api"],
};

export function layerMayImport(
	layer: string,
	target: string,
	profile: ArchProfile,
): boolean {
	if (target === "kernel") {
		return true;
	}
	if (profile !== "app" && profile !== "service") {
		return true;
	}
	const allowed = APP_LAYER_ORDER[layer];
	if (allowed === undefined) {
		return true;
	}
	return allowed.includes(target);
}

// SPEC §4.11.1: the first matching folder segment under the module dir names
// the layer; a file outside every configured layer dir is unlayered.
export function resolveLayer(
	file: string,
	moduleBase: string,
	layerDirs: ReadonlyArray<string>,
): string | undefined {
	const prefix = `${moduleBase}/`;
	if (!file.startsWith(prefix)) {
		return undefined;
	}
	const rest = file.slice(prefix.length);
	const slash = rest.indexOf("/");
	if (slash < 0) {
		return undefined;
	}
	const top = rest.slice(0, slash);
	if (!layerDirs.includes(top)) {
		return undefined;
	}
	return top;
}
