// SPEC §4.14.2 L0: at session start the three integrity floor rules judge
// the live repo (generated artifacts against the manifest, core.hooksPath and
// the installed hooks, the recorded engine against the pinned one), not only
// fixture marker reports (BUG-0106).
import { strict as assert } from "node:assert";
import test from "node:test";
import type { Finding, Scope } from "../../../src/features/engine/index.ts";
import {
	buildManifest,
	EXPECTED_HOOKS_PATH,
} from "../../../src/features/integrity/index.ts";
import { resolveEngineVersionMatch } from "../../../src/features/packs/enforcers/engine-version-guards.ts";
import {
	resolveGuardrailManifest,
	resolveHooksActive,
} from "../../../src/features/packs/enforcers/gate-guards.ts";
import { normalizeText, sha256Text } from "../../../src/kernel/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";
import { FakeFs } from "../../support/fake-fs.ts";
import { FakeGit } from "../../support/fake-git.ts";
import {
	checked,
	DECL,
	portsWith,
	ruleFor,
} from "../../support/pre-tool-scenario.ts";

const ARTIFACT = "AGENTS.md";
const BODY = "generated\n";

interface Repo {
	readonly fs: FakeFs;
	readonly git: FakeGit;
}

function repo(over: {
	recorded?: string;
	hooksPath?: string;
	artifact?: string;
}): Repo {
	const fs = new FakeFs();
	const git = new FakeGit();
	fs.seedText(".codictator/config.json", '{"version":1,"codictator":"1.2.3"}');
	fs.seedText(ARTIFACT, over.artifact ?? BODY);
	for (const hook of ["pre-commit", "commit-msg", "pre-push"]) {
		fs.seedText(`${EXPECTED_HOOKS_PATH}/${hook}`, "#!/bin/sh\n");
	}
	const manifest = buildManifest(over.recorded ?? "1.2.3", [
		{
			path: ARTIFACT,
			owner: "test",
			mode: "file",
			hash: sha256Text(normalizeText(BODY)),
		},
	]);
	fs.seedText(".codictator/manifest.json", JSON.stringify(manifest));
	git.setConfig("core.hooksPath", over.hooksPath ?? EXPECTED_HOOKS_PATH);
	return { fs, git };
}

async function startupFindings(
	state: Repo,
	scope: Scope = { files: [] },
	trigger: "startup" | "review" = "startup",
): Promise<Array<string>> {
	const ports = portsWith(state.fs, state.git);
	const found: Array<Finding> = [];
	for (const [id, resolve] of [
		["core/guardrail-manifest", resolveGuardrailManifest],
		["core/hooks-active", resolveHooksActive],
		["core/engine-version-match", resolveEngineVersionMatch],
	] as const) {
		const enforcer = checked(resolve(DECL, ruleFor(id), ports));
		found.push(
			...(await enforcer.check(
				{ trigger, scope, now: FIXED_INSTANT, configHash: "h" },
				{},
			)),
		);
	}
	return [...new Set(found.map((finding) => finding.ruleId))];
}

test("[§4.14.2] L0 stays quiet on a consistent repo", async () => {
	assert.deepEqual(await startupFindings(repo({})), []);
});

test("[§4.14.2] L0 core/guardrail-manifest names a generated artifact edited after regen", async () => {
	assert.deepEqual(await startupFindings(repo({ artifact: "edited\n" })), [
		"core/guardrail-manifest",
	]);
});

test("[§4.14.2 EC-9] L0 core/hooks-active names a core.hooksPath reset to the default", async () => {
	assert.deepEqual(await startupFindings(repo({ hooksPath: ".git/hooks" })), [
		"core/hooks-active",
	]);
});

test("[§4.14.2] L0 core/engine-version-match names a manifest recorded by another engine", async () => {
	assert.deepEqual(await startupFindings(repo({ recorded: "0.0.1" })), [
		"core/engine-version-match",
	]);
});

test("[§4.14.2] only a session-start scope with no disk files is judged live", async () => {
	const broken = repo({ hooksPath: ".git/hooks" });
	broken.fs.seedText("sample.txt", "manifest: present\nhooks: installed\n");
	assert.deepEqual(await startupFindings(broken, { files: [] }, "review"), []);
	assert.deepEqual(
		await startupFindings(broken, { files: ["sample.txt"] }),
		[],
	);
});
