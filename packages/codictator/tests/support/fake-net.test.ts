// SPEC §10.2: self-test for the scripted Net support.
import { strict as assert } from "node:assert";
import test from "node:test";
import { FakeNet } from "./fake-net.ts";

test("[§10.2] fake net answers routed responses and records requests", async () => {
	const net = new FakeNet();
	net.route("GET", "https://registry.example/v1/a", {
		status: 200,
		headers: {},
		body: '{"name":"a"}',
	});
	const hit = await net.request({
		method: "GET",
		url: "https://registry.example/v1/a",
		headers: {},
		timeoutMs: 1000,
	});
	assert.equal(hit.ok, true);
	if (!hit.ok) {
		return;
	}
	assert.equal(hit.value.status, 200);
	assert.equal(hit.value.body, '{"name":"a"}');
	assert.equal(net.requests.length, 1);
	const recorded = net.requests[0];
	assert.notEqual(recorded, undefined);
	if (recorded === undefined) {
		return;
	}
	assert.equal(recorded.url, "https://registry.example/v1/a");
});

test("[§10.2] fake net answers 404 for unrouted urls and errors when armed", async () => {
	const net = new FakeNet();
	const missing = await net.request({
		method: "GET",
		url: "https://registry.example/v1/missing",
		headers: {},
		timeoutMs: 1000,
	});
	assert.equal(missing.ok, true);
	if (!missing.ok) {
		return;
	}
	assert.equal(missing.value.status, 404);
	net.routeError("GET", "https://registry.example/v1/down", {
		code: "CDX-E401",
		message: "registry unavailable",
		remediation: "retry with a snapshot",
	});
	const down = await net.request({
		method: "GET",
		url: "https://registry.example/v1/down",
		headers: {},
		timeoutMs: 1000,
	});
	assert.equal(down.ok, false);
	if (down.ok) {
		return;
	}
	assert.equal(down.error.code, "CDX-E401");
});
