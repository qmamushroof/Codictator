// Owned `.npmrc` entry (§6.1): save-exact=true. Scoped registries name the
// hosts config.network.registries must allow (EC-8).
export const NPM_PUBLIC_REGISTRY_HOST = "registry.npmjs.org";

export interface NpmRegistryRef {
	readonly scope: string | undefined;
	readonly host: string;
	readonly url: string;
}

export interface NpmrcConfig {
	readonly saveExact: boolean | undefined;
	readonly registries: ReadonlyArray<NpmRegistryRef>;
}

function parseNpmrcLine(
	line: string,
	saveExact: { value: boolean | undefined },
	registries: Array<NpmRegistryRef>,
): void {
	const trimmed = line.trim();
	if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith(";")) {
		return;
	}
	const equals = trimmed.indexOf("=");
	if (equals < 0) {
		return;
	}
	const key = trimmed.slice(0, equals).trim();
	const value = trimmed.slice(equals + 1).trim();
	if (key === "save-exact") {
		saveExact.value = value === "true";
		return;
	}
	const scoped = /^@([^:]+):registry$/.exec(key);
	if (key !== "registry" && scoped === null) {
		return;
	}
	let host = "";
	try {
		host = new URL(value).hostname.toLowerCase();
	} catch {
		return;
	}
	registries.push({ scope: scoped?.[1], host, url: value });
}

export function parseNpmrc(text: string): NpmrcConfig {
	const saveExact: { value: boolean | undefined } = { value: undefined };
	const registries: Array<NpmRegistryRef> = [];
	for (const line of text.split("\n")) {
		parseNpmrcLine(line, saveExact, registries);
	}
	return { saveExact: saveExact.value, registries };
}

// SPEC §4.8.8 EC-8: a non-public registry host must arrive through
// config.network.registries; otherwise CDX-E702 and block.
export function privateRegistryHosts(
	config: NpmrcConfig,
): ReadonlyArray<string> {
	const hosts: Array<string> = [];
	for (const ref of config.registries) {
		if (ref.host !== NPM_PUBLIC_REGISTRY_HOST && !hosts.includes(ref.host)) {
			hosts.push(ref.host);
		}
	}
	return hosts.sort();
}
