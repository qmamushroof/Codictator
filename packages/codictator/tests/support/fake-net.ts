// SPEC §10.2: a scripted Net port for unit tests (SPEC §4.1.1). Routes are
// keyed by method plus URL, every request is recorded in order, and unmatched
// routes answer 404 so missing recordings fail loudly instead of hanging.
import type {
	CdxError,
	Net,
	NetRequest,
	NetResponse,
	Result,
} from "../../src/kernel/index.ts";

function routeKey(method: string, url: string): string {
	return `${method.toUpperCase()} ${url}`;
}

export class FakeNet implements Net {
	private readonly routes = new Map<string, Result<NetResponse>>();
	private readonly sent: Array<NetRequest> = [];

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
