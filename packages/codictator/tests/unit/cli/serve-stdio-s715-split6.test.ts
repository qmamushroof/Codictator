import { strict as assert } from "node:assert";

import test from "node:test";

import {
	decodeLine,
	errorFrame,
	invalidParamsError,
	invalidRequestFrame,
	methodNotFoundError,
	notificationFrame,
	parseErrorFrame,
	serverError,
	successFrame,
} from "../../../src/cli/serve-protocol.ts";

import { field } from "../../../src/cli/serve-shared.ts";

// The boot checks above never run a method body, so the rows below drive
// dispatchMethod, handleRun and the protocol codecs in-process on temp
// repos. They hold the §10.6 floors for the new serve files.

function recordOf(value: unknown): Record<string, unknown> {
	assert.equal(typeof value, "object");
	assert.notEqual(value, null);
	return value as Record<string, unknown>;
}

test("[§7.15] protocol decodeLine separates requests notifications syntax and bad lines", async () => {
	const request = decodeLine('{"jsonrpc":"2.0","id":7,"method":"status"}');
	assert.equal(request.kind, "request");
	if (request.kind === "request") {
		assert.equal(request.request.id, 7);
		assert.equal(request.request.method, "status");
	}
	const notified = decodeLine(
		'{"jsonrpc":"2.0","method":"events/appended","params":{"n":1}}',
	);
	assert.equal(notified.kind, "notification");
	assert.equal(decodeLine("{oops").kind, "syntax");
	assert.equal(decodeLine('"just a string"').kind, "bad");
	assert.equal(decodeLine('{"jsonrpc":"1.0","id":1,"method":"x"}').kind, "bad");
	assert.equal(
		decodeLine('{"jsonrpc":"2.0","id":[],"method":"status"}').kind,
		"bad",
	);
});

test("[§7.15] protocol frames round-trip through JSON with stable keys", async () => {
	const success = JSON.parse(successFrame(1, { done: true }).trim()) as Record<
		string,
		unknown
	>;
	assert.equal(field(success, "id"), 1);
	assert.equal(field(recordOf(field(success, "result")), "done"), true);
	const failure = JSON.parse(
		errorFrame("a", { code: -32601, message: "missing" }).trim(),
	) as Record<string, unknown>;
	assert.equal(field(recordOf(field(failure, "error")), "code"), -32601);
	const notified = JSON.parse(
		notificationFrame("events/appended", { n: 1 }).trim(),
	) as Record<string, unknown>;
	assert.equal(field(notified, "method"), "events/appended");
	assert.equal("id" in notified, false);
	const parsed = JSON.parse(parseErrorFrame().trim()) as Record<
		string,
		unknown
	>;
	assert.equal(field(recordOf(field(parsed, "error")), "code"), -32700);
	const invalid = JSON.parse(invalidRequestFrame(null).trim()) as Record<
		string,
		unknown
	>;
	assert.equal(field(recordOf(field(invalid, "error")), "code"), -32600);
	assert.equal(methodNotFoundError("zz").code, -32601);
	assert.ok(methodNotFoundError("zz").message.includes("zz"));
	assert.equal(invalidParamsError("detail").code, -32602);
	const coded = serverError("CDX-E010", "message", "remediation", { id: "x" });
	assert.equal(coded.code, -32000);
	assert.equal(
		field(coded.data as Record<string, unknown>, "code"),
		"CDX-E010",
	);
});
