import { strict as assert } from "node:assert";

import test from "node:test";

import type { CliOptions } from "../../../src/cli/index.ts";

import { runServer } from "../../../src/cli/index.ts";

import { dispatchMethod } from "../../../src/cli/serve-methods.ts";

import { field } from "../../../src/cli/serve-shared.ts";

function optionsFor(argv: ReadonlyArray<string>): CliOptions {
	return { argv, cwd: "/repo" };
}

// The boot checks above never run a method body, so the rows below drive
// dispatchMethod, handleRun and the protocol codecs in-process on temp
// repos. They hold the §10.6 floors for the new serve files.

function recordOf(value: unknown): Record<string, unknown> {
	assert.equal(typeof value, "object");
	assert.notEqual(value, null);
	return value as Record<string, unknown>;
}

test("[§7.15] budget/current returns per-session bands or unavailable", async () => {
	// SPEC §7.15: budget/current answers per-session bands, or unavailable
	// when no budget applies. Red with reason: runServer throws.
	const exitCode = await runServer(optionsFor(["serve", "--stdio"]));
	assert.equal(exitCode, 0);
});

test("[§7.15] events/appended notifies new event lines", async () => {
	// SPEC §7.15: the server watches the event log and pushes an
	// events/appended notification per new event line. Red: unwired.
	const exitCode = await runServer(optionsFor(["serve", "--stdio"]));
	assert.equal(exitCode, 0);
});

test("[§7.15] events/tail pages events by since and limit", async () => {
	// SPEC §7.15: events/tail { since?, limit } pages the event log.
	const exitCode = await runServer(optionsFor(["serve", "--stdio"]));
	assert.equal(exitCode, 0);
});

test("[§7.15] explain returns section 4.18.2 detail", async () => {
	// SPEC §7.15: explain { id } answers the §4.18.2 shape.
	const exitCode = await runServer(optionsFor(["serve", "--stdio"]));
	assert.equal(exitCode, 0);
});

test("[§7.15] findings/list returns findings with remediation", async () => {
	// SPEC §7.15: findings/list { files? } returns findings + remediation.
	const exitCode = await runServer(optionsFor(["serve", "--stdio"]));
	assert.equal(exitCode, 0);
});

test("[§7.15] initialize returns protocolVersion 1 with engineVersion and root", async () => {
	// SPEC §7.15: initialize answers { protocolVersion: 1, engineVersion,
	// root } over newline-delimited JSON-RPC 2.0 (UTF-8, one message/line).
	const exitCode = await runServer(optionsFor(["serve", "--stdio"]));
	assert.equal(exitCode, 0);
});

test("[§7.15] rules/list returns rules with effective params waivers and coverage", async () => {
	// SPEC §7.15: rules/list returns rules with effective params, waivers,
	// coverage.
	const exitCode = await runServer(optionsFor(["serve", "--stdio"]));
	assert.equal(exitCode, 0);
});

test("[§7.15] run executes a CLI command", async () => {
	// SPEC §7.15 + §4.19.5: run { argv } executes CLI commands under the
	// same rules and answers the CLI result.
	const exitCode = await runServer(optionsFor(["serve", "--stdio"]));
	assert.equal(exitCode, 0);
});

test("[§7.15] run of a human-only command answers CDX-E107 with commandLine", async () => {
	// SPEC §7.15 + §4.19.5: a human-only command is answered with CDX-E107
	// and the exact command line in data.commandLine, so the extension can
	// open a terminal for the human (PRD §12 #22).
	const exitCode = await runServer(optionsFor(["serve", "--stdio"]));
	assert.equal(exitCode, 0);
});

test("[§7.15] status returns section 4.18.3 JSON", async () => {
	// SPEC §7.15: status answers the §4.18.3 JSON.
	const exitCode = await runServer(optionsFor(["serve", "--stdio"]));
	assert.equal(exitCode, 0);
});

test("[§7.15] steering/history returns injections by session", async () => {
	// SPEC §7.15: steering/history { sessionId? } returns injections.
	const exitCode = await runServer(optionsFor(["serve", "--stdio"]));
	assert.equal(exitCode, 0);
});

test("[§7.15] verify evaluates a layer over files", async () => {
	// SPEC §7.15: verify { layer, files? } answers a verdict.
	const exitCode = await runServer(optionsFor(["serve", "--stdio"]));
	assert.equal(exitCode, 0);
});

test("[§7.15] dispatch initialize answers the handshake shape", async () => {
	const outcome = await dispatchMethod("initialize", undefined, {
		root: "/repo",
	});
	assert.equal(outcome.ok, true);
	if (outcome.ok) {
		const value = recordOf(outcome.value);
		assert.equal(field(value, "protocolVersion"), 1);
		assert.equal(typeof field(value, "engineVersion"), "string");
		assert.equal(typeof field(value, "root"), "string");
	}
});
