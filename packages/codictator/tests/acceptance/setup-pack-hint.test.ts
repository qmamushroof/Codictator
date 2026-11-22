// SPEC §4.19.6 step 8: through the public command entry, a pack-less setup
// on a fresh repo prints one repair line per built-in pack id except core,
// then the fresh-adoption hint. The seeded empty npm lockfile lets npm ci
// run with no dependency to fetch, so no network is touched.
import { strict as assert } from "node:assert";
import test from "node:test";
import { runCommand } from "../../src/cli/index.ts";
import { BUILTIN_PACK_IDS } from "../../src/features/packs/index.ts";
import { createTempRepo } from "../support/temp-repo.ts";

async function captureStdout(body: () => Promise<void>): Promise<string> {
	const write = process.stdout.write.bind(process.stdout);
	let text = "";
	process.stdout.write = ((chunk: string | Uint8Array): boolean => {
		text += String(chunk);
		return true;
	}) as typeof process.stdout.write;
	try {
		await body();
	} finally {
		process.stdout.write = write;
	}
	return text;
}

test("[§4.19.6] setup with no --pack prints a repair line per built-in pack except core and the fresh hint", async () => {
	// SPEC §4.19.6 step 8: the lines come from the built-in pack ids of
	// §4.4.2 except core, in list order.
	const ids = BUILTIN_PACK_IDS.filter((id) => id !== "core");
	const repo = createTempRepo({
		"README.md": "hi",
		"package.json": '{"name":"fixture","version":"1.0.0"}\n',
		"package-lock.json":
			'{"name":"fixture","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"fixture","version":"1.0.0"}}}\n',
	});
	try {
		let ok = false;
		const out = await captureStdout(async () => {
			const ran = await runCommand({ argv: ["setup", "--yes"], cwd: repo.dir });
			ok = ran.ok;
		});
		assert.equal(ok, true);
		const lines = out.split("\n");
		for (const id of ["typescript", "dotnet", "python"]) {
			assert.ok(lines.includes(`  npx codictator setup --repair --pack ${id}`));
		}
		assert.ok(!lines.some((line) => line.includes("--pack core")));
		const first = lines.indexOf(
			"To add a language pack, run the line for your language:",
		);
		assert.ok(first >= 0);
		assert.deepEqual(
			lines.slice(first + 1, first + 1 + ids.length),
			ids.map((id) => `  npx codictator setup --repair --pack ${id}`),
		);
		assert.ok(
			lines.includes(
				`Fresh adoption omits --repair: npx codictator setup --pack <${ids.join("|")}>`,
			),
		);
	} finally {
		repo.cleanup();
	}
});
