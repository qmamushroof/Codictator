// SPEC §4.1.1 and §9.2: the real Net port. Policy (the allowlist verdict)
// owns net-allow.ts; transport (redirects, the body cap) owns net-fetch.ts;
// this file re-exports the surface and owns NodeNet so existing `./net.ts`
// imports keep working.
import type { Net, NetRequest, NetResponse } from "./index.ts";
import {
	NET_ALLOWLIST,
	type NodeNetOptions,
	netHostAllowed,
	rejectNetUrl,
} from "./net-allow.ts";
import {
	fetchOnce,
	NET_MAX_BODY_BYTES,
	NET_MAX_REDIRECTS,
} from "./net-fetch.ts";
import { err, type Result } from "./result.ts";

export {
	NET_ALLOWLIST,
	NET_MAX_BODY_BYTES,
	NET_MAX_REDIRECTS,
	type NodeNetOptions,
	netHostAllowed,
	rejectNetUrl,
};

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
