// SPEC §4.19: the built bin entry runs when the executed path resolves to
// its own module. Under a workspace symlink argv keeps the link spelling
// while the loader resolves the real path, so the compare is realpath
// aware; otherwise linked installs exit silently.
import { strict as assert } from "node:assert";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isEntryModule } from "../../../src/kernel/index.ts";

test("[§4.19] bin entry answers its own module path", () => {
	const here = fileURLToPath(import.meta.url);
	assert.equal(isEntryModule(here, pathToFileURL(here).href), true);
});

test("[§4.19] bin entry ignores another module", () => {
	const here = fileURLToPath(import.meta.url);
	const other = pathToFileURL(
		path.join(
			path.dirname(here),
			"..",
			"..",
			"..",
			"src",
			"kernel",
			"index.ts",
		),
	).href;
	assert.equal(isEntryModule(here, other), false);
});

test("[§4.19] bin entry follows a workspace link to the real module", () => {
	// A directory junction plays the workspace symlink on every OS: the
	// argv spelling through the link differs from the real path, but the
	// entry still answers.
	const outer = mkdtempSync(path.join(tmpdir(), "codictator-entry-"));
	try {
		const realDir = path.join(outer, "pkg");
		mkdirSync(realDir, { recursive: true });
		const realFile = path.join(realDir, "main.js");
		writeFileSync(realFile, "export {};\n", "utf8");
		const linkDir = path.join(outer, "node_modules", "pkg");
		mkdirSync(path.dirname(linkDir), { recursive: true });
		symlinkSync(realDir, linkDir, "junction");
		const argvSpelling = path.join(linkDir, "main.js");
		assert.notEqual(path.resolve(argvSpelling), realFile);
		assert.equal(
			isEntryModule(argvSpelling, pathToFileURL(realFile).href),
			true,
		);
	} finally {
		rmSync(outer, { recursive: true, force: true });
	}
});
