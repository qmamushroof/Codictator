// SPEC §10.2: a scripted Net port for unit tests (SPEC §4.1.1). Routes are
// keyed by method plus URL, every request is recorded in order, and unmatched
// routes answer 404 so missing recordings fail loudly instead of hanging.
import {
	type CdxError,
	err,
	type Net,
	type NetRequest,
	type NetResponse,
	type Result,
	rejectNetUrl,
} from "../../src/kernel/index.ts";

function routeKey(method: string, url: string): string {
	return `${method.toUpperCase()} ${url}`;
}

export interface FakeNetOptions {
	readonly allowlist?: ReadonlyArray<string>;
}

export class FakeNet implements Net {
	private readonly routes = new Map<string, Result<NetResponse>>();
	private readonly sent: Array<NetRequest> = [];
	private allowlist: ReadonlyArray<string> | undefined;

	constructor(options: FakeNetOptions = {}) {
		this.allowlist = options.allowlist;
	}

	setAllowlist(hosts: ReadonlyArray<string>): void {
		this.allowlist = [...hosts];
	}

	route(method: string, url: string, response: NetResponse): void {
		this.routes.set(routeKey(method, url), { ok: true, value: response });
	}

	routeError(method: string, url: string, error: CdxError): void {
		this.routes.set(routeKey(method, url), { ok: false, error });
	}

	get requests(): ReadonlyArray<NetRequest> {
		return this.sent;
	}

	request(req: NetRequest): Promise<Result<NetResponse>> {
		this.sent.push(req);
		// SPEC §4.1.3 EC-4: with an allowlist armed, off-list hosts fail
		// CDX-E702 before any recording is consulted, like the real port
		// failing before any socket opens. Without an allowlist the fake
		// stays a plain scripted stub.
		if (this.allowlist !== undefined) {
			const rejected = rejectNetUrl(req.url, this.allowlist);
			if (rejected !== undefined) {
				return Promise.resolve(err(rejected));
			}
		}
		const stored = this.routes.get(routeKey(req.method, req.url));
		if (stored !== undefined) {
			return Promise.resolve(stored);
		}
		const notFound: Result<NetResponse> = {
			ok: true,
			value: { status: 404, headers: {}, body: "" },
		};
		return Promise.resolve(notFound);
	}
}
