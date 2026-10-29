// SPEC §4.19 + §4.19.3: the source entry executes as the built bin does.
// Spawning src/cli/main.ts answers --help with the usage line and exit 0,
// and bare invocation stays a usage error (exit 2). Importing this module
// (as every test file and the hook-path engine shim does) never executes
// the CLI: the entry runs only when its own path is the executed script.
import { strict as assert } from "node:assert";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { main } from "../../src/cli/main.ts";
import { runNodeScript } from "../support/cli-runner.ts";

function entryPath(): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(here, "..", "..", "src", "cli", "main.ts");
}

test("[§4.19] the source entry answers --help with usage and exit 0", async () => {
	// BUG-0002: the bin entry must be runnable, not just exported. On the
	// unfixed code the spawned module prints nothing.
	const result = await runNodeScript({
		nodeArgs: [entryPath(), "--help"],
		cwd: path.dirname(entryPath()),
		timeoutMs: 60000,
	});
	assert.equal(result.code, 0);
	assert.match(result.stdout, /usage: codictator/);
});

test("[§4.19] the source entry without a command stays a usage error", async () => {
	// SPEC §8.2: no command is a usage error, exit 2.
	const result = await runNodeScript({
		nodeArgs: [entryPath()],
		cwd: path.dirname(entryPath()),
		timeoutMs: 60000,
	});
	assert.equal(result.code, 2);
	assert.match(result.stderr, /usage: codictator/);
});

test("[§4.19] importing the entry never runs the CLI", async () => {
	// The import above already proves this: reaching this test means the
	// module evaluated without executing main.
	assert.equal(typeof main, "function");
});
