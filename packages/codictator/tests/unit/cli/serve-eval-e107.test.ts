// SPEC §4.2.4 EC-10 with §4.19.3: the stdio evaluation rows run under the
// launcher marker like the L1 runtime and git-hook paths, so findings/list
// and verify answer instead of refusing CDX-E107. Only the launcher's own
// mark hides; any other marker still refuses.
import { strict as assert } from "node:assert";
import test from "node:test";
import { dispatchMethod } from "../../../src/cli/serve-methods.ts";
import { field } from "../../../src/cli/serve-shared.ts";
import { loadRepoConfig } from "../../../src/cli/shared.ts";
import { hookEnv } from "../../../src/features/adapters/index.ts";
import { HOOK_MARKER } from "../../../src/features/config/index.ts";
import { FakeEnv } from "../../support/fake-env.ts";
import { createTempRepo } from "../../support/temp-repo.ts";

function recordOf(value: unknown): Record<string, unknown> {
	assert.equal(typeof value, "object");
	assert.notEqual(value, null);
	return value as Record<string, unknown>;
}

const MINIMAL_CONFIG = JSON.stringify({
	version: 1,
	codictator: "0.0.0",
	packs: [],
	harnesses: ["opencode"],
});

// The serve evaluation path reads the live process environment, so the
// launcher marker is set there and restored afterwards; each test file runs
// in its own process, so no other file observes it.
function withLauncherMarker(): () => void {
	const prior = process.env[HOOK_MARKER];
	process.env[HOOK_MARKER] = "1";
	return () => {
		if (prior === undefined) {
			delete process.env[HOOK_MARKER];
		} else {
			process.env[HOOK_MARKER] = prior;
		}
	};
}

test("[§4.2.4 EC-10] dispatch findings/list under the launcher marker answers instead of CDX-E107", async () => {
	const repo = createTempRepo({ ".codictator/config.json": MINIMAL_CONFIG });
	const restore = withLauncherMarker();
	try {
		const outcome = await dispatchMethod(
			"findings/list",
			{ files: [] },
			{
				root: repo.dir,
			},
		);
		assert.equal(outcome.ok, true);
		if (outcome.ok) {
			const value = recordOf(outcome.value);
			assert.equal(field(value, "decision"), "allow");
			assert.ok(Array.isArray(field(value, "findings")));
		}
	} finally {
		restore();
		repo.cleanup();
	}
});

test("[§4.2.4 EC-10] dispatch verify under the launcher marker answers instead of CDX-E107", async () => {
	const repo = createTempRepo({ ".codictator/config.json": MINIMAL_CONFIG });
	const restore = withLauncherMarker();
	try {
		const outcome = await dispatchMethod(
			"verify",
			{ layer: "L1", files: [] },
			{ root: repo.dir },
		);
		assert.equal(outcome.ok, true);
		if (outcome.ok) {
			const value = recordOf(outcome.value);
			assert.equal(field(value, "verdict"), "allow");
			assert.equal(field(value, "layer"), "L1");
		}
	} finally {
		restore();
		repo.cleanup();
	}
});

test("[§4.2.4 EC-10] a marker outside the launcher's own still refuses CDX-E107", async () => {
	// hookEnv hides only the launcher's own mark, so foreign markers pass
	// through untouched; config load without that hiding still refuses.
	const wrapped = hookEnv(
		new FakeEnv({ [HOOK_MARKER]: "1", CODICTATOR_AGENT: "1" }),
	);
	assert.equal(wrapped.get(HOOK_MARKER), undefined);
	assert.equal(wrapped.get("CODICTATOR_AGENT"), "1");
	const repo = createTempRepo({ ".codictator/config.json": MINIMAL_CONFIG });
	try {
		const configured = await loadRepoConfig(
			repo.dir,
			new FakeEnv({ [HOOK_MARKER]: "1" }),
		);
		assert.equal(configured.ok, false);
		if (!configured.ok) {
			assert.equal(configured.error.code, "CDX-E107");
		}
	} finally {
		repo.cleanup();
	}
});
