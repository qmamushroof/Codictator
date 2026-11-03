// SPEC §9.2: the static network allowlist verdict. Configured registry
// hosts, a detected GitHub Enterprise host and the generator LLM host
// arrive as extra hosts on NodeNet, never here. Only the hostname reaches
// an error message; the full URL can carry secrets in its query.
import { type CdxError, makeError } from "./errors.ts";

export const NET_ALLOWLIST: ReadonlyArray<string> = [
	"api.github.com",
	"api.nuget.org",
	"api.osv.dev",
	"builds.dotnet.microsoft.com",
	"nodejs.org",
	"pypi.org",
	"registry.npmjs.org",
	"www.python.org",
];

export interface NodeNetOptions {
	readonly extraHosts?: ReadonlyArray<string>;
}

export function netHostAllowed(
	host: string,
	extraHosts: ReadonlyArray<string> = [],
): boolean {
	const wanted = host.toLowerCase();
	for (const allowed of [...NET_ALLOWLIST, ...extraHosts]) {
		if (allowed.toLowerCase() === wanted) {
			return true;
		}
	}
	return false;
}

export function netError(message: string, remediation: string): CdxError {
	return makeError("CDX-E702", message, remediation);
}

// The allowlist verdict shared by the real port and its fake: undefined
// means the URL may be fetched.
export function rejectNetUrl(
	url: string,
	extraHosts: ReadonlyArray<string> = [],
): CdxError | undefined {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return netError(
			"network url is not an absolute url",
			"Use an absolute https URL on the network allowlist (SPEC §9.2).",
		);
	}
	if (parsed.protocol !== "https:") {
		return netError(
			`network host ${parsed.hostname} needs https`,
			"Use an https URL; plain http is never fetched.",
		);
	}
	if (!netHostAllowed(parsed.hostname, extraHosts)) {
		return netError(
			`network host ${parsed.hostname} is not on the allowlist`,
			"Use a host on the network allowlist (SPEC §9.2), or add a registry host via config.network.registries.",
		);
	}
	return undefined;
}
