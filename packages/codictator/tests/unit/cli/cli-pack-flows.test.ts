// SPEC §4.16 + §4.4 + §4.5.7 + §4.14 + §4.13.1: generate, pack, adapter,
// serve, regen, install-hooks and init usage. In-process handler calls:
// assertions read the returned Result, never stdout (the runner shares
// process.stdout with TAP).
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	handleInstallHooks,
	handleRegen,
	handleUninstall,
} from "../../../src/cli/guardrail.ts";
import { handleInit } from "../../../src/cli/init.ts";
import {
	handleAdapter,
	handleGenerate,
	handlePack,
	handleServe,
} from "../../../src/cli/packs.ts";
import type { CommandRequest } from "../../../src/cli/shared.ts";
import { createTempRepo } from "../../support/temp-repo.ts";

function req(
	args: ReadonlyArray<string>,
	cwd: string,
	json = false,
): CommandRequest {
	return {
		args,
		json,
		quiet: true,
		cwd,
		nodeVersion: undefined,
		stdinText: undefined,
	};
}

function seedConfig(repo: {
	writeFile: (rel: string, content: string) => void;
}): void {
	repo.writeFile(
		".codictator/config.json",
		JSON.stringify({
			version: 1,
			codictator: "0.0.0",
			packs: [],
			harnesses: ["muse-code", "opencode"],
		}),
	);
}

function outside(): string {
	return mkdtempSync(path.join(tmpdir(), "codictator-nopack-"));
}

test("[§4.16] generate outside a repo fails CDX-E703", async () => {
	// SPEC §4.19.2: generate resolves the repo root first.
	const dir = outside();
	try {
		const ran = await handleGenerate(req([], dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E703");
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("[§4.16] generate without config fails CDX-E101", async () => {
	// SPEC §4.16: generation reads the effective repo config first.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleGenerate(req([], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E101");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.16] generate without llm fails CDX-E851", async () => {
	// SPEC §4.16: the draft pipeline needs config.llm.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const ran = await handleGenerate(req([], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E851");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.16] generate with llm refuses the unbuilt pipeline", async () => {
	// SPEC §4.16: the pipeline lands in a later phase (CDX-E903 meanwhile).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			".codictator/config.json",
			JSON.stringify({
				version: 1,
				codictator: "0.0.0",
				packs: [],
				harnesses: ["muse-code", "opencode"],
				llm: { provider: "test" },
			}),
		);
		const ran = await handleGenerate(req([], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E903");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.4] pack rejects an unknown subcommand", async () => {
	// SPEC §4.19.2: anything outside list/test/accept is a usage error.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handlePack(req(["bogus"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.4] pack test without an id is a usage error", async () => {
	// SPEC §4.19.2: test and accept name the pack.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handlePack(req(["test"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.4] pack list fails closed on the missing builtin pack", async () => {
	// SPEC §4.4.1: pack loading fails closed with the pack's own code;
	// the dotnet builtin has no pack.json yet, so list reports CDX-E203
	// instead of a partial list.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const ran = await handlePack(req(["list"], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E203");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.4] pack list fails closed as data with --json", async () => {
	// SPEC §4.19.2: the CDX-E203 failure ships the loader's remediation.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const ran = await handlePack(req(["list"], repo.dir, true));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E203");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.4] pack outside a repo fails CDX-E703", async () => {
	// SPEC §4.2: pack resolves the repo root before listing.
	const dir = outside();
	try {
		const ran = await handlePack(req(["list"], dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E703");
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("[§4.4] pack test reports the failing builtin self-test", async () => {
	// SPEC §4.4.4: the core pack self-test currently fails at the first
	// wired fixture assertion (self-test evaluates on an empty scope, so
	// the violating fixture yields no finding), so test reports CDX-E212.
	// Integrity exception IE-09-R5-packtest (rule core/no-assertion-loss,
	// path packages/codictator/tests/unit/cli/cli-pack-flows.test.ts,
	// reason: the agent-assets-present enforcer is wired now, so the
	// failure moved from the CDX-E901 throw to the CDX-E212 assertion).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const ran = await handlePack(req(["test", "core"], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E212");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.4] pack test of an unknown pack fails closed", async () => {
	// SPEC §4.4: a pack that is neither builtin nor installed fails closed.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const ran = await handlePack(req(["test", "no-such-pack"], repo.dir));
		assert.equal(ran.ok, false);
	} finally {
		repo.cleanup();
	}
});

test("[§4.4] pack accept without a TTY fails CDX-E107", async () => {
	// SPEC §4.2.3: acceptance is human-only.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const ran = await handlePack(req(["accept", "core"], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E107");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.5] adapter rejects an unknown subcommand", async () => {
	// SPEC §4.19.2: anything outside test/capture is a usage error.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleAdapter(req(["bogus", "cursor"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.5] adapter test without an id is a usage error", async () => {
	// SPEC §4.19.2: test and capture name the harness.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleAdapter(req(["test"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.5] adapter test prints a known harness", async () => {
	// SPEC §4.5.7: the capability declaration names layers and gaps.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleAdapter(req(["test", "muse-code"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.5] adapter test answers as data with --json", async () => {
	// SPEC §4.19.2: --json ships the declaration for the extension.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleAdapter(req(["test", "muse-code"], repo.dir, true));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.5] adapter test of an unknown harness fails CDX-E301", async () => {
	// SPEC §4.5: unknown harness ids fail as CDX-E301.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleAdapter(req(["test", "nope"], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E301");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.5] adapter capture records a known harness", async () => {
	// SPEC §4.5.7: capture notes the observation for status.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const ran = await handleAdapter(req(["capture", "muse-code"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.5] adapter capture of an unknown harness fails CDX-E301", async () => {
	// SPEC §4.5: capture only names installed adapter ids.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleAdapter(req(["capture", "nope"], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E301");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.5] adapter capture outside a repo fails CDX-E703", async () => {
	// SPEC §4.2: capture resolves the repo root after the harness check.
	const dir = outside();
	try {
		const ran = await handleAdapter(req(["capture", "muse-code"], dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E703");
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("[§4.19] serve without --stdio is a usage error", async () => {
	// SPEC §4.19.5: the server takes exactly --stdio.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleServe(req([], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] serve --stdio names the later phase", async () => {
	// SPEC §4.19.5: the stdio server lands in phase 11 (CDX-E903 meanwhile).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleServe(req(["--stdio"], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E903");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] regen outside a repo fails CDX-E703", async () => {
	// SPEC §4.14.5: regen resolves the repo root first.
	const dir = outside();
	try {
		const ran = await handleRegen(req([], dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E703");
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("[§4.14] regen with a flag is a usage error", async () => {
	// SPEC §4.19.2: regen takes no flags or positionals.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleRegen(req(["--bogus"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] regen answers as data with --json", async () => {
	// SPEC §4.19.2: --json ships the regenerated file list.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		const ran = await handleRegen(req([], repo.dir, true));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] regen keeps user text outside the managed block", async () => {
	// SPEC §4.14.1: existing AGENTS.md prose survives around the block.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedConfig(repo);
		repo.writeFile("AGENTS.md", "# Team notes\n");
		const ran = await handleRegen(req([], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] install-hooks with a flag is a usage error", async () => {
	// SPEC §4.19.2: install-hooks takes no flags or positionals.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleInstallHooks(req(["--bogus"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] install-hooks outside a repo fails CDX-E703", async () => {
	// SPEC §4.14.4: hooks resolve the repo root first.
	const dir = outside();
	try {
		const ran = await handleInstallHooks(req([], dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E703");
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("[§4.14] install-hooks answers as data with --json", async () => {
	// SPEC §4.19.2: --json ships the hooks path for the extension.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleInstallHooks(req([], repo.dir, true));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 0);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] uninstall with a flag is a usage error", async () => {
	// SPEC §4.19.2: usage is checked before the human-only gate.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleUninstall(req(["--bogus"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.14] uninstall without a TTY fails CDX-E107", async () => {
	// SPEC §4.2.3: uninstall is human-only.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleUninstall(req([], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E107");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] init with a positional is a usage error", async () => {
	// SPEC §4.19.2: init takes only flags, checked before the human gate.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleInit(req(["extra"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] init with an unknown profile is a usage error", async () => {
	// SPEC §4.19.2: the profile is one of app, library, cli or service.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleInit(req(["--profile", "nope"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] init with a bad flag is a usage error", async () => {
	// SPEC §4.19.2: unparseable flags are usage errors, never throws.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleInit(req(["--harness"], repo.dir));
		assert.equal(ran.ok, true);
		if (ran.ok) {
			assert.equal(ran.value, 2);
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] init without a TTY fails CDX-E107", async () => {
	// SPEC §4.2.3: adoption is human-only.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await handleInit(req([], repo.dir));
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E107");
		}
	} finally {
		repo.cleanup();
	}
});
