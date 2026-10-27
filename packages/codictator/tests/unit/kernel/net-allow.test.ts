// Standing deviation (same as the branch deviation): these branch-level unit
// tests pass green and stay unlisted while the future-phase red rows stay
// listed. Covers SPEC §4.1.1 and §9.2 net allowlist branches with no sockets:
// netHostAllowed case handling, rejectNetUrl verdicts, and the NodeNet
// pre-socket refusal. Live fetching stays out of unit tests by design.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	NET_ALLOWLIST,
	NodeNet,
	netHostAllowed,
	rejectNetUrl,
} from "../../../src/kernel/index.ts";

test("[§4.1] net allowlist matches hosts case-insensitively", () => {
	assert.equal(netHostAllowed("API.GITHUB.COM"), true);
	assert.equal(netHostAllowed("api.github.com"), true);
	assert.equal(netHostAllowed("evil.example.com"), false);
});

test("[§4.1] net extra hosts extend the allowlist", () => {
	assert.equal(netHostAllowed("ghe.example.com", ["ghe.example.com"]), true);
	assert.equal(netHostAllowed("ghe.example.com"), false);
});

test("[§4.1] net relative url is refused", () => {
	const rejected = rejectNetUrl("not-a-url");
	assert.notEqual(rejected, undefined);
});

test("[§4.1] net plain http url is refused", () => {
	const rejected = rejectNetUrl("http://registry.npmjs.org/x");
	assert.notEqual(rejected, undefined);
	assert.equal(rejected?.code, "CDX-E702");
});

test("[§4.1] net off-list https host is refused", () => {
	const rejected = rejectNetUrl("https://evil.example.com/x");
	assert.notEqual(rejected, undefined);
	assert.equal(rejected?.code, "CDX-E702");
	assert.ok(rejected?.message.includes("evil.example.com"));
});

test("[§4.1] net allowlisted https url passes", () => {
	assert.equal(rejectNetUrl("https://registry.npmjs.org/x"), undefined);
	assert.ok(NET_ALLOWLIST.includes("registry.npmjs.org"));
});

test("[§4.1] net request without a method throws", () => {
	const net = new NodeNet();
	assert.throws(() =>
		net.request({
			method: "",
			url: "https://registry.npmjs.org/x",
			headers: {},
			timeoutMs: 1000,
		}),
	);
});

test("[§4.1] net off-list request fails before any socket opens", async () => {
	const net = new NodeNet();
	const denied = await net.request({
		method: "GET",
		url: "https://evil.example.com/x",
		headers: {},
		timeoutMs: 1000,
	});
	assert.equal(denied.ok, false);
	if (!denied.ok) {
		assert.equal(denied.error.code, "CDX-E702");
	}
});

test("[§4.1] net extra hosts allow a configured registry", () => {
	const rejected = rejectNetUrl("https://ghe.example.com/x", [
		"ghe.example.com",
	]);
	assert.equal(rejected, undefined);
	assert.equal(netHostAllowed("GHE.EXAMPLE.COM", ["ghe.example.com"]), true);
});
