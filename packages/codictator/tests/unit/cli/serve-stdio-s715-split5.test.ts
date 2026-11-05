import { strict as assert } from "node:assert";

import test from "node:test";

import { dispatchMethod } from "../../../src/cli/serve-methods.ts";

import { handleRun } from "../../../src/cli/serve-run.ts";

import { field } from "../../../src/cli/serve-shared.ts";

// The boot checks above never run a method body, so the rows below drive
// dispatchMethod, handleRun and the protocol codecs in-process on temp
// repos. They hold the §10.6 floors for the new serve files.

function recordOf(value: unknown): Record<string, unknown> {
	assert.equal(typeof value, "object");
	assert.notEqual(value, null);
	return value as Record<string, unknown>;
}

test("[§7.15] dispatch of an unknown method answers method not found", async () => {
	const outcome = await dispatchMethod("bogus/method", undefined, {
		root: "/repo",
	});
	assert.equal(outcome.ok, false);
	if (!outcome.ok) {
		assert.equal(outcome.error.code, -32601);
		assert.ok(outcome.error.message.includes("bogus/method"));
	}
});

test("[§7.15] run of a human-only command answers CDX-E107 with commandLine", async () => {
	const stub = (): Promise<{ ok: true; value: number }> =>
		Promise.resolve({ ok: true, value: 0 });
	for (const argv of [
		["waive", "core/no-secrets", "--reason", "x"],
		["baseline", "capture"],
	]) {
		const outcome = await handleRun({ argv }, { root: "/repo", execute: stub });
		assert.equal(outcome.ok, false);
		if (!outcome.ok) {
			assert.equal(outcome.error.code, -32000);
			assert.ok(outcome.error.message.startsWith("CDX-E107"));
			const data = recordOf(outcome.error.data);
			assert.equal(field(data, "code"), "CDX-E107");
			assert.equal(field(data, "commandLine"), `codictator ${argv.join(" ")}`);
		}
	}
});

test("[§7.15] run executes argv through the executor and captures output", async () => {
	const silent = (): Promise<{ ok: true; value: number }> =>
		Promise.resolve({ ok: true, value: 0 });
	const quiet = await handleRun(
		{ argv: ["status"] },
		{
			root: "/repo",
			execute: silent,
		},
	);
	assert.equal(quiet.ok, true);
	if (quiet.ok) {
		const value = recordOf(quiet.value);
		assert.equal(field(value, "exitCode"), 0);
		assert.equal(field(value, "stdout"), "");
		assert.equal(field(value, "stderr"), "");
	}
	const noisy = (): Promise<{ ok: true; value: number }> => {
		process.stdout.write("out");
		process.stderr.write(Buffer.from("err"));
		return Promise.resolve({ ok: true, value: 0 });
	};
	const captured = await handleRun(
		{ argv: ["status"] },
		{
			root: "/repo",
			execute: noisy,
		},
	);
	assert.equal(captured.ok, true);
	if (captured.ok) {
		const value = recordOf(captured.value);
		assert.equal(field(value, "stdout"), "out");
		assert.equal(field(value, "stderr"), "err");
	}
});

test("[§7.15] run with bad params answers invalid params", async () => {
	const stub = (): Promise<{ ok: true; value: number }> =>
		Promise.resolve({ ok: true, value: 0 });
	for (const params of [undefined, {}, { argv: [] }, { argv: ["ok", 5] }]) {
		const outcome = await handleRun(params, { root: "/repo", execute: stub });
		assert.equal(outcome.ok, false);
		if (!outcome.ok) {
			assert.equal(outcome.error.code, -32602);
		}
	}
});

test("[§7.15] run of a failing command answers its code and remediation", async () => {
	const failing = (): Promise<{
		ok: false;
		error: { code: string; message: string; remediation: string };
	}> =>
		Promise.resolve({
			ok: false,
			error: { code: "CDX-E001", message: "boom", remediation: "retry" },
		});
	const outcome = await handleRun(
		{ argv: ["status"] },
		{
			root: "/repo",
			execute: failing,
		},
	);
	assert.equal(outcome.ok, true);
	if (outcome.ok) {
		const value = recordOf(outcome.value);
		assert.equal(typeof field(value, "exitCode"), "number");
		assert.equal(field(value, "code"), "CDX-E001");
		assert.equal(field(value, "remediation"), "retry");
	}
});
