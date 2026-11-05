// SPEC §7.1 + §4.13.1: the init path guarantees the manifest-owned
// .gitignore entries. In-process sequence calls: assertions read the
// returned Result and the written tree, never stdout.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
	defaultHarnesses,
	type InitFlags,
	runInitSequence,
} from "../../../src/cli/init-plan.ts";
import type { CommandRequest } from "../../../src/cli/shared.ts";
import { createTempRepo } from "../../support/temp-repo.ts";

function req(args: ReadonlyArray<string>, cwd: string): CommandRequest {
	return {
		args,
		json: false,
		quiet: true,
		cwd,
		nodeVersion: undefined,
		stdinText: undefined,
	};
}

function flags(): InitFlags {
	return { harnesses: [], profile: "", packs: [], tools: [], repair: false };
}

const EXPECTED =
	".codictator/state/\n.codictator/cache/\n.codictator/tool/node_modules/\n";

test("[§7.1] init sequence writes the manifest-owned .gitignore entries", async () => {
	// SPEC §7.1: the adoption path guarantees state, cache and tool
	// node_modules stay ignored. BUG-0031: init wrote no .gitignore entries,
	// so consumer repos staged node_modules.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const initFlags = flags();
		const sequenced = await runInitSequence(
			repo.dir,
			req([], repo.dir),
			initFlags,
			defaultHarnesses(initFlags),
			"0.0.0",
		);
		assert.equal(sequenced.ok, true);
		if (!sequenced.ok) {
			return;
		}
		assert.equal(readFileSync(`${repo.dir}/.gitignore`, "utf8"), EXPECTED);
		assert.ok(
			sequenced.value.written.some((entry) => entry.path === ".gitignore"),
		);
	} finally {
		repo.cleanup();
	}
});

test("[§7.1] init sequence keeps user .gitignore text and fills the gaps", async () => {
	// SPEC §7.1: the guarantee appends missing entries without touching
	// user text; a repeat run adds nothing and lists no .gitignore write.
	const repo = createTempRepo({
		"README.md": "hi",
		".gitignore": "node_modules/\n.codictator/cache/\n",
	});
	try {
		const initFlags = flags();
		const first = await runInitSequence(
			repo.dir,
			req([], repo.dir),
			initFlags,
			defaultHarnesses(initFlags),
			"0.0.0",
		);
		assert.equal(first.ok, true);
		if (!first.ok) {
			return;
		}
		assert.equal(
			readFileSync(`${repo.dir}/.gitignore`, "utf8"),
			"node_modules/\n.codictator/cache/\n.codictator/state/\n.codictator/tool/node_modules/\n",
		);
		assert.ok(first.value.written.some((entry) => entry.path === ".gitignore"));
		const second = await runInitSequence(
			repo.dir,
			req([], repo.dir),
			initFlags,
			defaultHarnesses(initFlags),
			"0.0.0",
		);
		assert.equal(second.ok, true);
		if (!second.ok) {
			return;
		}
		assert.ok(
			!second.value.written.some((entry) => entry.path === ".gitignore"),
		);
	} finally {
		repo.cleanup();
	}
});
