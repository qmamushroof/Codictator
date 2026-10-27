// SPEC §10.2: self-test for the 127.0.0.1 replay server.
import { strict as assert } from "node:assert";
import test from "node:test";
import { jsonRoute, startReplayServer, textRoute } from "./replay-server.ts";

test("[§10.2] replay server answers fixed routes on 127.0.0.1", async () => {
	const server = await startReplayServer({
		"GET /v1/packages": jsonRoute({ names: ["a"] }),
		"POST /v1/llm": textRoute("answer", 201),
	});
	try {
		assert.ok(server.url.startsWith("http://127.0.0.1:"));
		const get = await fetch(`${server.url}/v1/packages`);
		assert.equal(get.status, 200);
		assert.equal(await get.text(), '{"names":["a"]}');
		const post = await fetch(`${server.url}/v1/llm`, { method: "POST" });
		assert.equal(post.status, 201);
		assert.equal(await post.text(), "answer");
		const missing = await fetch(`${server.url}/nope`);
		assert.equal(missing.status, 404);
		assert.equal(server.requests.length, 3);
		const recorded = server.requests[0];
		assert.notEqual(recorded, undefined);
		if (recorded === undefined) {
			return;
		}
		assert.deepEqual(
			{ method: recorded.method, path: recorded.path },
			{ method: "GET", path: "/v1/packages" },
		);
	} finally {
		await server.close();
	}
});

test("[§10.2] replay server records request bodies in order", async () => {
	const server = await startReplayServer({
		"POST /v1/osv": jsonRoute({ vulns: [] }),
	});
	try {
		await fetch(`${server.url}/v1/osv`, {
			method: "POST",
			body: '{"package":"a"}',
		});
		await fetch(`${server.url}/v1/osv`, {
			method: "POST",
			body: '{"package":"b"}',
		});
		assert.deepEqual(
			server.requests.map((request) => request.body),
			['{"package":"a"}', '{"package":"b"}'],
		);
	} finally {
		await server.close();
	}
});
