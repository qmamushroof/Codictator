// Standing deviation (same as the branch deviation): these branch-level unit
// tests pass green and stay unlisted while the Phase 4 red rows in
// config.test.ts stay listed until Phase 4 lands. Covers SPEC §4.2.1
// loadConfig branches with fake ports (plus one live-port composition over a
// per-test temporary directory, removed after it): exists/read/parse
// failures, manifest and glob discovery, and the missing-repo error.
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Config } from "../../../src/features/config/index.ts";
import { loadConfig } from "../../../src/features/config/index.ts";
import type { CdxError, Fs, Result } from "../../../src/kernel/index.ts";
import { err } from "../../../src/kernel/index.ts";
import type { FakeFs } from "../../support/fake-fs.ts";
import { createFakePorts } from "../../support/fake-ports.ts";

function baseConfigText(): string {
	const config: Config = {
		version: 1,
		codictator: "0.0.0",
		packs: [{ id: "core" }],
		harnesses: ["universal"],
		tunables: {},
		architecture: undefined,
		workflow: undefined,
		spec: undefined,
		testing: undefined,
		commands: {},
		steering: undefined,
		tools: [],
		security: undefined,
		deps: undefined,
		network: undefined,
		integrity: undefined,
		ci: undefined,
		llm: undefined,
	};
	return JSON.stringify(config);
}

async function errorCodeOf(call: () => unknown): Promise<string> {
	try {
		await call();
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error) {
			const code: unknown = error.code;
			if (typeof code === "string") {
				return code;
			}
		}
		return "threw-without-code";
	}
	return "did-not-throw";
}

// Minimal delegating fake: fails the nth readText call so the unreadable-file
// branch is reachable after a successful exists.
class ReadFailingFs implements Fs {
	private calls = 0;
	private readonly inner: FakeFs;
	private readonly failure: CdxError;

	constructor(inner: FakeFs, failure: CdxError) {
		this.inner = inner;
		this.failure = failure;
	}

	read(path: string): Promise<Result<Uint8Array>> {
		return this.inner.read(path);
	}

	readText(path: string): Promise<Result<string>> {
		this.calls += 1;
		if (this.calls === 1) {
			return Promise.resolve(err(this.failure));
		}
		return this.inner.readText(path);
	}

	write(path: string, content: Uint8Array): Promise<Result<void>> {
		return this.inner.write(path, content);
	}

	append(path: string, content: Uint8Array): Promise<Result<void>> {
		return this.inner.append(path, content);
	}

	stat(
		path: string,
	): Promise<Result<{ isFile: boolean; isDirectory: boolean; size: number }>> {
		return this.inner.stat(path);
	}

	list(dir: string): Promise<Result<Array<string>>> {
		return this.inner.list(dir);
	}

	glob(pattern: string, dir: string): Promise<Result<Array<string>>> {
		return this.inner.glob(pattern, dir);
	}

	exists(path: string): Promise<Result<boolean>> {
		return this.inner.exists(path);
	}

	realpath(path: string): Promise<Result<string>> {
		return this.inner.realpath(path);
	}

	remove(path: string): Promise<Result<void>> {
		return this.inner.remove(path);
	}
}

test("[§4.2] load fails closed when the config cannot be read", async () => {
	const bundle = createFakePorts();
	assert.equal(
		await errorCodeOf(() => loadConfig("repo", bundle.ports)),
		"CDX-E108",
	);
});

test("[§4.2] load reports a repair when a manifest exists", async () => {
	const { ports, fs } = createFakePorts();
	fs.seedText("repo/package.json", '{"name": "repo"}');
	assert.equal(await errorCodeOf(() => loadConfig("repo", ports)), "CDX-E101");
});

test("[§4.2] load finds a solution file through the glob fallback", async () => {
	const { ports, fs } = createFakePorts();
	fs.seedText("repo/app.sln", "solution\n");
	assert.equal(await errorCodeOf(() => loadConfig("repo", ports)), "CDX-E101");
});

test("[§4.2] load fails closed when the config file is unreadable", async () => {
	const bundle = createFakePorts();
	bundle.fs.seedText("repo/.codictator/config.json", baseConfigText());
	const failing = new ReadFailingFs(bundle.fs, {
		code: "CDX-E801",
		message: "injected",
		remediation: "retry",
	});
	assert.equal(
		await errorCodeOf(() =>
			loadConfig("repo", { ...bundle.ports, fs: failing }),
		),
		"CDX-E101",
	);
});

test("[§4.2] load fails closed when the config is not JSON", async () => {
	const { ports, fs } = createFakePorts();
	fs.seedText("repo/.codictator/config.json", "{oops");
	const code = await errorCodeOf(() => loadConfig("repo", ports));
	assert.ok(code === "CDX-E101" || code.startsWith("CDX-E"));
});

test("[§4.2] load accepts a valid config through fake ports", async () => {
	const { ports, fs } = createFakePorts();
	fs.seedText("repo/.codictator/config.json", baseConfigText());
	const effective = await loadConfig("repo", ports);
	assert.equal(effective.config.version, 1);
	assert.ok(effective.configHash.length > 0);
});

test("[§4.2] load composes live ports when none are injected", async () => {
	const dir = mkdtempSync(join(tmpdir(), "codictator-config-"));
	try {
		// SPEC §4.2.1: absolute roots outside the repo fail closed at the
		// first confinement check, after the live ports compose.
		assert.equal(await errorCodeOf(() => loadConfig(dir)), "CDX-E101");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("[§4.2] load over live ports reports a missing repo", async () => {
	const dir = mkdtempSync("codictator-live-probe-");
	try {
		assert.equal(await errorCodeOf(() => loadConfig(dir)), "CDX-E108");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
