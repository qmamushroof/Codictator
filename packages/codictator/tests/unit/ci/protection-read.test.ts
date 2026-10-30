// SPEC §4.15.2 + §4.15.7 EC-1/EC-6/EC-7 + §8.2: the live branch-protection
// read behind `ci verify`. Fakes stand in for Net and Env; no test reaches
// the public network. One EC per test; the exit pin asserts ciVerifyExit.
import { strict as assert } from "node:assert";
import test from "node:test";
import { ciVerifyExit } from "../../../src/cli/ci.ts";
import {
	evaluateProtection,
	readProtection,
} from "../../../src/features/ci/index.ts";
import type { NetResponse } from "../../../src/kernel/index.ts";
import { FakeEnv } from "../../support/fake-env.ts";
import { FakeNet } from "../../support/fake-net.ts";

const REPO_URL = "https://api.github.com/repos/o/r";
const PROTECTION_URL = `${REPO_URL}/branches/main/protection`;

function actionsEnv(): FakeEnv {
	return new FakeEnv({
		GITHUB_ACTIONS: "true",
		GITHUB_REPOSITORY: "o/r",
		GITHUB_TOKEN: "fake-token",
	});
}

function jsonResponse(status: number, value: unknown): NetResponse {
	return { status, headers: {}, body: JSON.stringify(value) };
}

function routeRepo(net: FakeNet, branch: string): void {
	net.route("GET", REPO_URL, jsonResponse(200, { default_branch: branch }));
}

test("[§4.15.2] protected branch maps to a readable blocking-capable read", async () => {
	// SPEC §4.15.2: classic endpoint fields map onto ProtectionRead, so a
	// fully-protected branch evaluates clean.
	const net = new FakeNet();
	routeRepo(net, "main");
	net.route(
		"GET",
		PROTECTION_URL,
		jsonResponse(200, {
			required_status_checks: { contexts: ["verify", "lint"] },
			allow_squash_merge: false,
			allow_force_pushes: { enabled: false },
			allow_deletions: { enabled: false },
		}),
	);
	const read = await readProtection(net, actionsEnv());
	assert.deepEqual(read, {
		readable: true,
		verifyRequired: true,
		forcePushBlocked: true,
		deletionBlocked: true,
		allowSquashMerge: false,
	});
	assert.deepEqual(evaluateProtection(read), []);
	// The GitHub API 403s headerless calls ("Request forbidden by
	// administrative rules"), so the read must carry a User-Agent.
	const uaKey = "User-Agent";
	assert.ok(net.requests.length > 0);
	assert.ok(
		net.requests
			.map((request) => request.headers[uaKey])
			.every((ua) => typeof ua === "string" && ua !== ""),
	);
});

test("[§4.15 EC-7] reported-not-protected blocks", async () => {
	// SPEC §4.15.7 EC-7: a 404 on the protection endpoint is readable, so
	// the missing required check and the open push/delete settings block.
	const net = new FakeNet();
	routeRepo(net, "main");
	net.route("GET", PROTECTION_URL, { status: 404, headers: {}, body: "" });
	const read = await readProtection(net, actionsEnv());
	assert.deepEqual(read, {
		readable: true,
		verifyRequired: false,
		forcePushBlocked: false,
		deletionBlocked: false,
		allowSquashMerge: true,
	});
	const findings = evaluateProtection(read);
	assert.ok(
		findings.some((finding) =>
			finding.message.includes("not a required check"),
		),
	);
	assert.ok(
		findings.some((finding) => finding.message.includes("not blocked")),
	);
	assert.equal(ciVerifyExit(findings), 1);
});

test("[§4.15 EC-6] branch protection API returns 403", async () => {
	// SPEC §4.15.7 EC-6: 403 is unreadable, so the gate advises instead of
	// allowing, and advise-only findings exit 0 per §8.2.
	const net = new FakeNet();
	routeRepo(net, "main");
	net.route("GET", PROTECTION_URL, { status: 403, headers: {}, body: "" });
	const read = await readProtection(net, actionsEnv());
	assert.equal(read, undefined);
	const findings = evaluateProtection(read);
	assert.equal(findings.length, 2);
	assert.ok(
		findings.every((finding) => finding.message.includes("cannot confirm")),
	);
	assert.equal(ciVerifyExit(findings), 0);
});

test("[§4.15 EC-1] PR from a fork with a read-only token", async () => {
	// SPEC §4.15.7 EC-1: off-CI (and tokenless) runs attempt no request and
	// advise; the Net fake records nothing.
	const net = new FakeNet();
	const offCi = new FakeEnv({
		GITHUB_REPOSITORY: "o/r",
		GITHUB_TOKEN: "fake-token",
	});
	assert.equal(await readProtection(net, offCi), undefined);
	const noToken = new FakeEnv({
		GITHUB_ACTIONS: "true",
		GITHUB_REPOSITORY: "o/r",
	});
	assert.equal(await readProtection(net, noToken), undefined);
	assert.equal(net.requests.length, 0);
});

test("[§4.15.2] timeout errors advise without throwing", async () => {
	// SPEC §4.15.2: any Net failure (timeout, unreachable repo, unparseable
	// body) resolves to absent, never to a throw or an allow.
	const net = new FakeNet();
	routeRepo(net, "main");
	net.routeError("GET", PROTECTION_URL, {
		code: "CDX-E702",
		message: "timed out",
		remediation: "Retry.",
	});
	assert.equal(await readProtection(net, actionsEnv()), undefined);
	const missing = new FakeNet();
	missing.route("GET", REPO_URL, { status: 404, headers: {}, body: "" });
	assert.equal(await readProtection(missing, actionsEnv()), undefined);
	const broken = new FakeNet();
	routeRepo(broken, "main");
	broken.route("GET", PROTECTION_URL, {
		status: 200,
		headers: {},
		body: "not json\n",
	});
	assert.equal(await readProtection(broken, actionsEnv()), undefined);
});

test("[§8.2] ci verify exits 0 on advise-only findings", async () => {
	// SPEC §8.2 + §4.15.1: ci verify exits per §8 — 0 on allow or advise
	// only, 1 once any finding blocks.
	assert.equal(ciVerifyExit([]), 0);
	assert.equal(ciVerifyExit(evaluateProtection(undefined)), 0);
});
