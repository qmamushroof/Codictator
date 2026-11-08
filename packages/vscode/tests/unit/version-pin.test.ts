// SPEC §4.20.1 + §4.20.2: version plumbing plus row-display pin. The host
// adapter reads the version through extensions.getExtension with the full
// marketplace id; a missing surface falls back to the 0.0.0 pin. Row packs
// show plain names (no bogus @0.0.0/@unknown suffix).
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { engineRequestFor } from "../../src/engine-client.ts";
import {
	buildExtensionApi,
	extensionVersionOf,
} from "../../src/host-adapter.ts";
import { runSetupCommand } from "../../src/palette-command.ts";
import { listRuleGroups } from "../../src/views.ts";
import { createFakeVscode } from "../support/fake-vscode.ts";

function createHost(version: unknown): unknown {
	return {
		commands: {
			registerCommand(): void {
				// Recorded only to satisfy the duck-typed host shape.
			},
		},
		extensions: {
			getExtension(id: string): unknown {
				assert.equal(id, "codictator.codictator-vscode");
				if (version instanceof Error) {
					throw version;
				}
				return version;
			},
		},
		window: {},
		workspace: {},
	};
}

function realPackageVersion(): string {
	const text = readFileSync(
		new URL("../../package.json", import.meta.url),
		"utf8",
	);
	const parsed: unknown = JSON.parse(text);
	const versionKey = "version";
	if (
		typeof parsed === "object" &&
		parsed !== null &&
		"version" in parsed &&
		typeof (parsed as Record<string, unknown>)[versionKey] === "string"
	) {
		return (parsed as Record<string, string>)[versionKey] ?? "";
	}
	return "";
}

test("[§4.20.1] extensionVersionOf reads the version through the full extension id", () => {
	const host = createHost({ packageJSON: { version: "0.2.9" } });
	assert.equal(extensionVersionOf(host), "0.2.9");
	assert.equal(buildExtensionApi(host).extensionVersion(), "0.2.9");
});

test("[§4.20.1] extension version falls back to the 0.0.0 pin without a surface", () => {
	assert.equal(extensionVersionOf({}), "0.0.0");
	assert.equal(extensionVersionOf({ extensions: {} }), "0.0.0");
	assert.equal(extensionVersionOf(createHost(undefined)), "0.0.0");
	assert.equal(extensionVersionOf(createHost({ packageJSON: {} })), "0.0.0");
	assert.equal(
		extensionVersionOf(createHost({ packageJSON: { version: "" } })),
		"0.0.0",
	);
	assert.equal(extensionVersionOf(createHost(new Error("gone"))), "0.0.0");
});

test("[§4.20.1] fake defaults to the real package.json version", () => {
	const expected = realPackageVersion();
	assert.ok(expected !== "" && expected !== "0.0.0");
	assert.equal(createFakeVscode().extensionVersion(), expected);
});

test("[§4.20.2] rule groups fall back to a plain name without a version", async () => {
	const groups = await listRuleGroups(["/repo"], () =>
		Promise.resolve({ rules: [{ id: "core/arch-module-mapped" }] }),
	);
	assert.equal(groups.length, 1);
	assert.equal(groups[0]?.pack, "unknown");
});

test("[§4.20.2] canned rules/list pack is a plain name without a version", async () => {
	const answer = await engineRequestFor()("/repo", "rules/list", {});
	assert.ok(typeof answer === "object" && answer !== null);
	const rules = (answer as { rules: Array<{ pack: string }> }).rules;
	assert.equal(rules[0]?.pack, "core");
});

test("[§4.20.3] setup pre-fill interpolates the plumbed version", () => {
	const api = createFakeVscode();
	const line = runSetupCommand(api);
	assert.equal(line, `npx codictator@${api.extensionVersion()} setup`);
});
