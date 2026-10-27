// SPEC §10.2: registry, OSV and LLM traffic never reaches the public network;
// integration tests point at this 127.0.0.1 server instead. Routes are fixed
// recordings keyed by method plus path (query strings ignored); unknown routes
// answer 404 so a missing recording fails loudly. Recorded fixture bodies land
// here once step 2.4 adds them; until then tests pass fixed responses.
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";

export interface ReplayRoute {
	readonly status: number;
	readonly headers?: Readonly<Record<string, string>>;
	readonly body: string;
}

export interface RecordedRequest {
	readonly method: string;
	readonly path: string;
	readonly body: string;
}

export interface StartedReplayServer {
	readonly url: string;
	readonly port: number;
	readonly requests: Array<RecordedRequest>;
	close(): Promise<void>;
}

export function jsonRoute(value: unknown, status = 200): ReplayRoute {
	return {
		status,
		headers: { "content-type": "application/json" },
		body: JSON.stringify(value),
	};
}

export function textRoute(body: string, status = 200): ReplayRoute {
	return { status, headers: { "content-type": "text/plain" }, body };
}

export function startReplayServer(
	routes: Readonly<Record<string, ReplayRoute>>,
): Promise<StartedReplayServer> {
	return new Promise((resolve, reject) => {
		const requests: Array<RecordedRequest> = [];
		const server: Server = createServer(
			(req: IncomingMessage, res: ServerResponse) => {
				const chunks: Array<Uint8Array> = [];
				req.on("data", (chunk: Uint8Array) => {
					chunks.push(chunk);
				});
				req.on("end", () => {
					const method = req.method ?? "GET";
					const rawUrl = req.url ?? "/";
					const pathname = new URL(rawUrl, "http://127.0.0.1").pathname;
					const body = Buffer.concat(chunks).toString("utf8");
					requests.push({ method, path: pathname, body });
					const route: ReplayRoute | undefined =
						routes[`${method} ${pathname}`];
					if (route === undefined) {
						res.writeHead(404, { "content-type": "application/json" });
						res.end('{"error":"no route"}');
						return;
					}
					res.writeHead(route.status, {
						"content-type": "application/json",
						...(route.headers ?? {}),
					});
					res.end(route.body);
				});
			},
		);
		server.on("error", (error: Error) => {
			reject(error);
		});
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (address === null || typeof address === "string") {
				server.close();
				reject(new Error("replay server did not bind to 127.0.0.1"));
				return;
			}
			const port = address.port;
			resolve({
				url: `http://127.0.0.1:${port}`,
				port,
				requests,
				close: (): Promise<void> =>
					new Promise((done) => {
						server.close(() => {
							done();
						});
					}),
			});
		});
	});
}
