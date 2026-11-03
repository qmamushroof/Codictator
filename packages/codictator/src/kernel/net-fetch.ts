// SPEC §4.1.1 and §4.1.3 EC-4: the Net transport. HTTPS only; every
// redirect hop is re-checked against the allowlist before its socket opens,
// so an allowlisted response can never bounce to an off-list host. Bodies
// past 32 MiB fail instead of buffering.
import type { IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { NetResponse } from "./index.ts";
import { netError, rejectNetUrl } from "./net-allow.ts";
import { err, ok, type Result } from "./result.ts";

// SPEC §4.1.1: response size cap.
export const NET_MAX_BODY_BYTES = 32 * 1024 * 1024;

// SPEC §4.1.3 EC-4: redirects are followed only to allowlisted hosts; past
// this many hops the request fails instead of looping.
export const NET_MAX_REDIRECTS = 5;

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

function handleRedirect(
	current: URL,
	status: number,
	location: string | undefined,
	method: string,
	headers: Readonly<Record<string, string>>,
	body: string | undefined,
	timeoutMs: number,
	redirects: number,
	extraHosts: ReadonlyArray<string>,
	resolve: (result: Result<NetResponse>) => void,
	finish: (result: Result<NetResponse>) => void,
): void {
	if (location === undefined) {
		finish(err(netError("redirect has no location", "Retry the request.")));
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
}

function pipeBody(
	incoming: IncomingMessage,
	status: number,
	hostname: string,
	finish: (result: Result<NetResponse>) => void,
): void {
	const chunks: Array<Buffer> = [];
	let kept = 0;
	incoming.on("data", (chunk: Buffer) => {
		kept += chunk.length;
		if (kept > NET_MAX_BODY_BYTES) {
			incoming.destroy();
			finish(
				err(
					netError(
						`response body from ${hostname} exceeds the 32 MiB cap`,
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
					`network read from ${hostname} failed`,
					"Check connectivity and retry.",
				),
			),
		);
	});
}

function handleIncoming(
	incoming: IncomingMessage,
	current: URL,
	method: string,
	headers: Readonly<Record<string, string>>,
	body: string | undefined,
	timeoutMs: number,
	redirects: number,
	extraHosts: ReadonlyArray<string>,
	resolve: (result: Result<NetResponse>) => void,
	finish: (result: Result<NetResponse>) => void,
): void {
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
		handleRedirect(
			current,
			status,
			location,
			method,
			headers,
			body,
			timeoutMs,
			redirects,
			extraHosts,
			resolve,
			finish,
		);
		return;
	}
	pipeBody(incoming, status, current.hostname, finish);
}

function sendRequest(
	current: URL,
	method: string,
	headers: Readonly<Record<string, string>>,
	body: string | undefined,
	timeoutMs: number,
	redirects: number,
	extraHosts: ReadonlyArray<string>,
	resolve: (result: Result<NetResponse>) => void,
	finish: (result: Result<NetResponse>) => void,
): void {
	const outgoing = httpsRequest(
		current,
		{ method, headers: { ...headers } },
		(incoming) => {
			handleIncoming(
				incoming,
				current,
				method,
				headers,
				body,
				timeoutMs,
				redirects,
				extraHosts,
				resolve,
				finish,
			);
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

export function fetchOnce(
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
	sendRequest(
		current,
		method,
		headers,
		body,
		timeoutMs,
		redirects,
		extraHosts,
		resolve,
		finish,
	);
}
