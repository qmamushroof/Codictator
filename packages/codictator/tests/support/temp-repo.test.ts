// SPEC §10.2: self-test for the temporary git repo builder.
import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import test from "node:test";
import { createTempRepo } from "./temp-repo.ts";

test("[§10.2] temp repo commits seeded files and starts clean", () => {
	const repo = createTempRepo({ "a.txt": "hello\n", "sub/b.txt": "world\n" });
	try {
		const head = repo.git(["rev-parse", "HEAD"]).trim();
		assert.match(head, /^[0-9a-f]{40}$/);
		assert.equal(repo.git(["status", "--porcelain"]).trim(), "");
		repo.writeFile("c.txt", "third\n");
		repo.commit("second");
		const log = repo.git(["log", "--oneline"]).trim().split("\n");
		assert.equal(log.length, 2);
	} finally {
		repo.cleanup();
	}
	assert.equal(existsSync(repo.dir), false);
});

test("[§10.2] temp repo commits identical fixtures to identical hashes", () => {
	const first = createTempRepo({ "a.txt": "same\n" });
	const second = createTempRepo({ "a.txt": "same\n" });
	try {
		assert.equal(
			first.git(["rev-parse", "HEAD"]).trim(),
			second.git(["rev-parse", "HEAD"]).trim(),
		);
	} finally {
		first.cleanup();
		second.cleanup();
	}
});
