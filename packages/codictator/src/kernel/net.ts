// SPEC §4.1.1 and §9.2: the real Net port. The host must be on the SPEC §9.2
// allowlist (static hosts below plus the caller's extra hosts: configured
// registries, a detected GitHub Enterprise host, the generator's LLM host),
// else CDX-E702 before any socket opens. HTTPS only; every redirect hop is
// re-checked, so an allowlisted response can never bounce to an off-list
// host (EC-4). Bodies past 32 MiB fail instead of buffering.
import type { IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { type CdxError, makeError } from "./errors.ts";
import type { Net, NetRequest, NetResponse } from "./index.ts";
import { err, ok, type Result } from "./result.ts";

// SPEC §9.2: the static network allowlist. Configured registry hosts, a
// detected GitHub Enterprise host and the generator LLM host arrive as
// extra hosts on NodeNet, never here.
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

// SPEC §4.1.1: response size cap.
export const NET_MAX_BODY_BYTES = 32 * 1024 * 1024;

// SPEC §4.1.3 EC-4: redirects are followed only to allowlisted hosts; past
// this many hops the request fails instead of looping.
export const NET_MAX_REDIRECTS = 5;

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

function netError(message: string, remediation: string): CdxError {
	return makeError("CDX-E702", message, remediation);
}

// The allowlist verdict shared by the real port and its fake: undefined
// means the URL may be fetched. Only the hostname reaches the message; the
// full URL can carry secrets in its query.
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

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function headerValue(
	headers: IncomingMessage["headers"],
	name: string,
): string | undefined {
	const found = headers[name];
	if (Array.isArray(found)) {
		return found[0];
	}
	return found;
}

function responseHeaders(
	headers: IncomingMessage["headers"],
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		if (value === undefined) {
			continue;
		}
		out[name] = Array.isArray(value) ? value.join(", ") : String(value);
	}
	return out;
}

// Authorization must not cross hosts on a redirect; the redirected hop
// re-authenticates itself or not at all.
function headersForHop(
	headers: Readonly<Record<string, string>>,
	sameHost: boolean,
): Record<string, string> {
	if (sameHost) {
		return { ...headers };
	}
	const out: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		const lowered = name.toLowerCase();
		if (lowered === "authorization" || lowered === "proxy-authorization") {
			continue;
		}
		out[name] = value;
	}
	return out;
}

function fetchOnce(
	current: URL,
	method: string,
	headers: Readonly<Record<string, string>>,
	body: string | undefined,
	timeoutMs: number,
	redirects: number,
	extraHosts: ReadonlyArray<string>,
	resolve: (result: Result<NetResponse>) => void,
): void {
	let settled = false;
	const finish = (result: Result<NetResponse>): void => {
		if (settled) {
			return;
		}
		settled = true;
		resolve(result);
	};
	const outgoing = httpsRequest(
		current,
		{ method, headers: { ...headers } },
		(incoming) => {
			const status = incoming.statusCode;
			if (status === undefined) {
				incoming.destroy();
				finish(
					err(netError("network response has no status", "Retry the request.")),
				);
				return;
			}
			if (REDIRECT_STATUSES.has(status)) {
				const location = headerValue(incoming.headers, "location");
				incoming.destroy();
				if (location === undefined) {
					finish(
						err(netError("redirect has no location", "Retry the request.")),
					);
					return;
				}
				if (redirects >= NET_MAX_REDIRECTS) {
					finish(
						err(
							netError(
								`too many redirects past ${current.hostname}`,
								"Use the final URL directly.",
							),
						),
					);
					return;
				}
				let next: URL;
				try {
					next = new URL(location, current);
				} catch {
					finish(
						err(
							netError(
								"redirect location is not a valid url",
								"Use the final URL directly.",
							),
						),
					);
					return;
				}
				// SPEC §4.1.3 EC-4: the hop is allowlisted before its socket
				// opens, so a redirect can never smuggle a fetch off-list.
				const rejected = rejectNetUrl(next.href, extraHosts);
				if (rejected !== undefined) {
					finish(err(rejected));
					return;
				}
				const nextMethod = status === 303 ? "GET" : method;
				const nextBody = status === 303 ? undefined : body;
				fetchOnce(
					next,
					nextMethod,
					headersForHop(headers, next.hostname === current.hostname),
					nextBody,
					timeoutMs,
					redirects + 1,
					extraHosts,
					resolve,
				);
				return;
			}
			const chunks: Array<Buffer> = [];
			let kept = 0;
			incoming.on("data", (chunk: Buffer) => {
				kept += chunk.length;
				if (kept > NET_MAX_BODY_BYTES) {
					incoming.destroy();
					finish(
						err(
							netError(
								`response body from ${current.hostname} exceeds the 32 MiB cap`,
								"Fetch a smaller resource or raise the cap in config.",
							),
						),
					);
					return;
				}
				chunks.push(chunk);
			});
			incoming.on("end", () => {
				finish(
					ok({
						status,
						headers: responseHeaders(incoming.headers),
						body: Buffer.concat(chunks).toString("utf8"),
					}),
				);
			});
			incoming.on("error", () => {
				finish(
					err(
						netError(
							`network read from ${current.hostname} failed`,
							"Check connectivity and retry.",
						),
					),
				);
			});
		},
	);
	outgoing.on("error", () => {
		finish(
			err(
				netError(
					`network request to ${current.hostname} failed`,
					"Check connectivity and retry.",
				),
			),
		);
	});
	outgoing.setTimeout(timeoutMs, () => {
		outgoing.destroy();
		finish(
			err(
				netError(
					`network request to ${current.hostname} timed out`,
					"Retry with a larger timeout.",
				),
			),
		);
	});
	if (body !== undefined) {
		outgoing.write(body);
	}
	outgoing.end();
}

export class NodeNet implements Net {
	private readonly extraHosts: ReadonlyArray<string>;

	constructor(options: NodeNetOptions = {}) {
		this.extraHosts = options.extraHosts ?? [];
	}

	request(req: NetRequest): Promise<Result<NetResponse>> {
		if (req.method === "") {
			throw new Error("net request must name an HTTP method");
		}
		// SPEC §4.1.3 EC-4: rejected before any socket opens.
		const rejected = rejectNetUrl(req.url, this.extraHosts);
		if (rejected !== undefined) {
			return Promise.resolve(err(rejected));
		}
		const current = new URL(req.url);
		return new Promise((resolve) => {
			fetchOnce(
				current,
				req.method,
				req.headers,
				req.body,
				req.timeoutMs,
				0,
				this.extraHosts,
				resolve,
			);
		});
	}
}
