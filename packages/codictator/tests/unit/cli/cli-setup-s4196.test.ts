import { strict as assert } from "node:assert";

import { readFileSync } from "node:fs";

import test from "node:test";

import {
	defaultHarnesses,
	type InitFlags,
	runInitSequence,
} from "../../../src/cli/init-plan.ts";

import type { SetupStep } from "../../../src/cli/setup.ts";

import { setupGitignoreStep } from "../../../src/cli/setup-gitignore.ts";

import { hasEffectivePacks } from "../../../src/cli/setup-handoff.ts";

import {
	setupInstallHere,
	setupInstallLayout,
} from "../../../src/cli/setup-install.ts";

import type { CommandRequest } from "../../../src/cli/shared.ts";

import { createTempRepo } from "../../support/temp-repo.ts";

function req(
	args: ReadonlyArray<string>,
	cwd: string,
	json = false,
	nodeVersion: string | undefined = undefined,
	answer: string | undefined = undefined,
): CommandRequest {
	return {
		args,
		json,
		quiet: true,
		cwd,
		nodeVersion,
		stdinText: answer,
	};
}

function flagsWithPacks(packs: Array<string>): InitFlags {
	return {
		harnesses: [],
		profile: "",
		packs,
		tools: [],
		repair: false,
	};
}

test("[§4.19.6] setup install layout pins the engine outside npm repos", async () => {
	// SPEC §4.19.4: npm repos install at the root; other repos get
	// .codictator/tool/package.json with the exact engine pin.
	const npmRepo = createTempRepo({ "package.json": '{"name":"x"}' });
	try {
		const steps: Array<SetupStep> = [];
		const laid = await setupInstallLayout(
			req([], npmRepo.dir),
			npmRepo.dir,
			steps,
		);
		assert.equal(laid.ok, true);
		if (laid.ok) {
			assert.equal(laid.value.dirRel, ".");
			assert.equal(laid.value.lockRel, "package-lock.json");
		}
	} finally {
		npmRepo.cleanup();
	}
	const plain = createTempRepo({ "README.md": "hi" });
	try {
		const steps: Array<SetupStep> = [];
		const laid = await setupInstallLayout(
			req([], plain.dir, false, undefined, "y"),
			plain.dir,
			steps,
			{ isTty: () => true },
		);
		assert.equal(laid.ok, true);
		if (!laid.ok) {
			return;
		}
		assert.equal(laid.value.dirRel, ".codictator/tool");
		const manifest = readFileSync(
			`${plain.dir}/.codictator/tool/package.json`,
			"utf8",
		);
		assert.ok(manifest.includes('"codictator"'));
		const again = await setupInstallLayout(
			req([], plain.dir, false, undefined, "y"),
			plain.dir,
			steps,
			{ isTty: () => true },
		);
		assert.equal(again.ok, true);
	} finally {
		plain.cleanup();
	}
});

test("[§4.19.6] setup install fails closed without a lockfile", async () => {
	// SPEC §4.19.6 step 5: no lockfile means npm ci cannot run — CDX-E003
	// before any spawn.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const steps: Array<SetupStep> = [];
		const ran = await setupInstallHere(
			req([], repo.dir),
			repo.dir,
			{ dir: repo.dir, lockRel: "package-lock.json", dirRel: "." },
			steps,
		);
		assert.equal(ran.ok, false);
		if (!ran.ok) {
			assert.equal(ran.error.code, "CDX-E003");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.19.6] setup gitignore step records the guarantee", async () => {
	// SPEC §4.19.6 step 3: the step wrapper pushes the gitignore outcome.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const steps: Array<SetupStep> = [];
		const ran = await setupGitignoreStep(req([], repo.dir), repo.dir, steps);
		assert.equal(ran.ok, true);
		assert.equal(steps.length, 1);
		assert.equal(steps[0]?.step, "gitignore");
	} finally {
		repo.cleanup();
	}
});

test("[§4.19.6] effective packs mirror flags then the written config", async () => {
	// SPEC §4.19.6 step 8: explicit --pack flags win; otherwise the
	// written config owns it; missing or malformed config means empty.
	const flagged = createTempRepo({ "README.md": "hi" });
	try {
		assert.equal(
			await hasEffectivePacks(flagged.dir, flagsWithPacks(["typescript"])),
			true,
		);
		assert.equal(
			await hasEffectivePacks(flagged.dir, flagsWithPacks([])),
			false,
		);
	} finally {
		flagged.cleanup();
	}
	const packed = createTempRepo({
		"README.md": "hi",
		".codictator/config.json": '{"packs":["typescript"]}',
	});
	try {
		assert.equal(await hasEffectivePacks(packed.dir, flagsWithPacks([])), true);
	} finally {
		packed.cleanup();
	}
	const bare = createTempRepo({
		"README.md": "hi",
		".codictator/config.json": '{"packs":[]}',
	});
	try {
		assert.equal(await hasEffectivePacks(bare.dir, flagsWithPacks([])), false);
	} finally {
		bare.cleanup();
	}
	const broken = createTempRepo({
		"README.md": "hi",
		".codictator/config.json": "not json",
	});
	try {
		assert.equal(
			await hasEffectivePacks(broken.dir, flagsWithPacks([])),
			false,
		);
	} finally {
		broken.cleanup();
	}
});

test("[§4.19.6] setup init sequence writes the shared plan tail", async () => {
	// SPEC §4.13.1: init and setup run the same write-then-guard tail
	// through one helper; the helper writes the plan and guards fresh
	// config and baseline in a fresh repo.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const flags = flagsWithPacks([]);
		const sequenced = await runInitSequence(
			repo.dir,
			req([], repo.dir),
			flags,
			defaultHarnesses(flags),
			"unknown",
		);
		assert.equal(sequenced.ok, true);
		if (!sequenced.ok) {
			return;
		}
		assert.ok(sequenced.value.written.length > 0);
		assert.ok(
			sequenced.value.written.some(
				(entry) => entry.path === ".codictator/config.json",
			),
		);
		assert.equal(sequenced.value.baseline, true);
	} finally {
		repo.cleanup();
	}
});
