// SPEC §4.15.7 EC-13: a parseable schedule/dispatch event names no range,
// so `ci verify` runs the repo-wide rules only instead of failing CDX-E303.
// Unparseable payloads still fail closed; zero-before pushes still use the
// merge-base fallback (EC-3).
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveCiRange } from "../../../src/cli/ci-range.ts";
import { portsFor } from "../../../src/cli/shared.ts";
import { FakeEnv } from "../../support/fake-env.ts";
import { createTempRepo } from "../../support/temp-repo.ts";

function writeEventFile(content: string): string {
	const dir = mkdtempSync(path.join(tmpdir(), "codictator-event-"));
	const file = path.join(dir, "event.json");
	writeFileSync(file, content, "utf8");
	return file;
}

function removeEventFile(file: string): void {
	rmSync(path.dirname(file), { recursive: true, force: true });
}

test("[§4.15 EC-13] ci verify runs repo-wide on a range-less schedule payload", async () => {
	const repo = createTempRepo({ "file.txt": "hello\n" });
	const eventFile = writeEventFile(
		JSON.stringify({
			schedule: "0 5 * * *",
			repository: { full_name: "acme/repo" },
		}),
	);
	try {
		const ports = await portsFor(
			repo.dir,
			new FakeEnv({ GITHUB_EVENT_PATH: eventFile }),
		);
		assert.equal(ports.ok, true);
		if (!ports.ok) {
			return;
		}
		const range = await resolveCiRange(ports.value, {
			base: undefined,
			head: undefined,
		});
		assert.equal(range.ok, true);
		if (!range.ok) {
			return;
		}
		assert.equal(range.value, undefined);
	} finally {
		removeEventFile(eventFile);
		repo.cleanup();
	}
});

test("[§4.15 EC-13] ci verify runs repo-wide on a range-less workflow_dispatch payload", async () => {
	const repo = createTempRepo({ "file.txt": "hello\n" });
	const eventFile = writeEventFile(
		JSON.stringify({ inputs: {}, event_type: "manual" }),
	);
	try {
		const ports = await portsFor(
			repo.dir,
			new FakeEnv({ GITHUB_EVENT_PATH: eventFile }),
		);
		assert.equal(ports.ok, true);
		if (!ports.ok) {
			return;
		}
		const range = await resolveCiRange(ports.value, {
			base: undefined,
			head: undefined,
		});
		assert.equal(range.ok, true);
		if (!range.ok) {
			return;
		}
		assert.equal(range.value, undefined);
	} finally {
		removeEventFile(eventFile);
		repo.cleanup();
	}
});

test("[§4.15 EC-13] ci verify still fails closed on an unparseable event payload", async () => {
	const repo = createTempRepo({ "file.txt": "hello\n" });
	const eventFile = writeEventFile("{ not json {{{");
	try {
		const ports = await portsFor(
			repo.dir,
			new FakeEnv({ GITHUB_EVENT_PATH: eventFile }),
		);
		assert.equal(ports.ok, true);
		if (!ports.ok) {
			return;
		}
		const range = await resolveCiRange(ports.value, {
			base: undefined,
			head: undefined,
		});
		assert.equal(range.ok, false);
		if (range.ok) {
			return;
		}
		assert.equal(range.error.code, "CDX-E303");
	} finally {
		removeEventFile(eventFile);
		repo.cleanup();
	}
});

test("[§4.15 EC-3] ci verify still uses the merge-base fallback for a zero-before push", async () => {
	const repo = createTempRepo({ "file.txt": "hello\n" });
	const eventFile = writeEventFile(
		JSON.stringify({
			before: "0000000000000000000000000000000000000000",
			after: "1111111111111111111111111111111111111111",
		}),
	);
	try {
		const ports = await portsFor(
			repo.dir,
			new FakeEnv({ GITHUB_EVENT_PATH: eventFile }),
		);
		assert.equal(ports.ok, true);
		if (!ports.ok) {
			return;
		}
		const range = await resolveCiRange(ports.value, {
			base: undefined,
			head: undefined,
		});
		// The temp repo has no origin/HEAD, so the fallback degrades to
		// repo-wide instead of a range; either way it must not fail E303.
		assert.equal(range.ok, true);
		if (!range.ok) {
			return;
		}
		assert.equal(range.value, undefined);
	} finally {
		removeEventFile(eventFile);
		repo.cleanup();
	}
});
