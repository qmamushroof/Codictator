import { strict as assert } from "node:assert";

import test from "node:test";

import {
	evaluateProtection,
	readProtection,
} from "../../../src/features/ci/index.ts";

import type { NetResponse } from "../../../src/kernel/index.ts";

import { FakeEnv } from "../../support/fake-env.ts";

import { FakeNet } from "../../support/fake-net.ts";

const REPO_URL = "https://api.github.com/repos/o/r";

const PROTECTION_URL = `${REPO_URL}/branches/main/protection`;

const RULES_URL = `${REPO_URL}/rules/branches/main`;

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

function routeRepoWithSettings(net: FakeNet, branch: string): void {
	net.route(
		"GET",
		REPO_URL,
		jsonResponse(200, { default_branch: branch, allow_squash_merge: false }),
	);
}

test("[§4.15.2] ruleset read resolves before classic", async () => {
	// SPEC §4.15.2: branch rules go first and map onto the same
	// ProtectionRead, so a readable ruleset settles the verdict and classic
	// is never consulted.
	const net = new FakeNet();
	routeRepoWithSettings(net, "main");
	net.route(
		"GET",
		RULES_URL,
		jsonResponse(200, [
			{ type: "creation" },
			{
				type: "required_status_checks",
				parameters: {
					required_status_checks: [{ context: "verify", integration_id: 1 }],
					strict_required_status_checks_policy: true,
				},
			},
			{ type: "non_fast_forward" },
			{ type: "deletion" },
			{ type: "pull_request" },
		]),
	);
	net.route(
		"GET",
		PROTECTION_URL,
		jsonResponse(200, {
			required_status_checks: { contexts: [] },
			allow_squash_merge: true,
			allow_force_pushes: { enabled: true },
			allow_deletions: { enabled: true },
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
	assert.deepEqual(
		net.requests.map((request) => request.url),
		[REPO_URL, RULES_URL],
	);
});

test("[§4.15.2] matrix-suffixed verify name matches via rulesets", async () => {
	// SPEC §4.15.2: matrix jobs report `verify (ubuntu-latest)`; the
	// anchored match strips the parenthesised suffix, so it still counts.
	const net = new FakeNet();
	routeRepoWithSettings(net, "main");
	net.route(
		"GET",
		RULES_URL,
		jsonResponse(200, [
			{
				type: "required_status_checks",
				parameters: {
					required_status_checks: [{ context: "verify (ubuntu-latest)" }],
				},
			},
		]),
	);
	const read = await readProtection(net, actionsEnv());
	assert.equal(read?.verifyRequired, true);
});

test("[§4.15.2] lookalike check names do not count as verify", async () => {
	// SPEC §4.15.2: the anchored match rejects `pre-verify` and `verifier`
	// on both the ruleset path and the classic fallback path.
	const viaRulesets = new FakeNet();
	routeRepoWithSettings(viaRulesets, "main");
	viaRulesets.route(
		"GET",
		RULES_URL,
		jsonResponse(200, [
			{
				type: "required_status_checks",
				parameters: {
					required_status_checks: [
						{ context: "pre-verify" },
						{ context: "verifier (ubuntu-latest)" },
					],
				},
			},
		]),
	);
	assert.equal(
		(await readProtection(viaRulesets, actionsEnv()))?.verifyRequired,
		false,
	);
	const viaClassic = new FakeNet();
	routeRepo(viaClassic, "main");
	viaClassic.route(
		"GET",
		PROTECTION_URL,
		jsonResponse(200, {
			required_status_checks: { contexts: ["pre-verify", "verifier"] },
			allow_squash_merge: false,
			allow_force_pushes: { enabled: false },
			allow_deletions: { enabled: false },
		}),
	);
	assert.equal(
		(await readProtection(viaClassic, actionsEnv()))?.verifyRequired,
		false,
	);
});

test("[§4.15.2] unreadable rulesets fall through to classic", async () => {
	// SPEC §4.15.2: a 403 on branch rules is not a verdict; classic stays
	// the fallback, so a protected branch still reads clean.
	const net = new FakeNet();
	routeRepo(net, "main");
	net.route("GET", RULES_URL, { status: 403, headers: {}, body: "" });
	net.route(
		"GET",
		PROTECTION_URL,
		jsonResponse(200, {
			required_status_checks: { contexts: ["verify"] },
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
});
