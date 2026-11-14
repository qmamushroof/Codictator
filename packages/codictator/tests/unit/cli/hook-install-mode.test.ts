// SPEC §4.14.4 + §9.2 + BUG-0093: install-hooks writes the hooks with the
// plan's mode (755). Git silently skips a non-executable hook under
// core.hooksPath, so before the fix no Codictator hook ran on POSIX.
import { strict as assert } from "node:assert";
import { statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { writeHookFiles, writeHooksWith } from "../../../src/cli/hook-files.ts";
import { FakeFs } from "../../support/fake-fs.ts";
import { createTempRepo } from "../../support/temp-repo.ts";

class RecordingFs extends FakeFs {
	readonly modes = new Map<string, number | undefined>();

	override write(
		file: string,
		content: Uint8Array,
		mode?: number,
	): ReturnType<FakeFs["write"]> {
		this.modes.set(file, mode);
		return super.write(file, content);
	}
}

const HOOKS = ["pre-commit", "commit-msg", "pre-push"];

test("[§4.14.4] install-hooks asks the Fs port for mode 755 on every hook (BUG-0093)", async () => {
	const fs = new RecordingFs();
	const done = await writeHooksWith(fs);
	assert.equal(done.ok, true);
	for (const hook of HOOKS) {
		assert.equal(fs.modes.get(`.githooks/${hook}`), 0o755);
	}
	assert.equal(fs.modes.get(".githooks/.gitattributes"), undefined);
});

test("[§4.14.4] install-hooks leaves each written hook executable on POSIX (BUG-0093)", {
	skip: process.platform === "win32",
}, async () => {
	const repo = createTempRepo();
	try {
		const done = await writeHookFiles(repo.dir);
		assert.equal(done.ok, true);
		for (const hook of HOOKS) {
			const mode = statSync(path.join(repo.dir, ".githooks", hook)).mode;
			assert.equal(mode & 0o111, 0o111);
		}
		const attrs = statSync(path.join(repo.dir, ".githooks", ".gitattributes"));
		assert.equal(attrs.mode & 0o111, 0);
	} finally {
		repo.cleanup();
	}
});
