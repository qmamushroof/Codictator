// SPEC §4.7.2 + BUG-0099: this repo's own workflows must pass the shell
// analyser, so a staged edit of them never blocks on a parser gap.
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { extractShellSources } from "../../../src/features/packs/enforcers/shell-sources.ts";
import {
	analyseShell,
	matchDangerousShell,
} from "../../../src/kernel/index.ts";

const DIR = fileURLToPath(
	new URL("../../../../../.github/workflows/", import.meta.url),
);

test("[§4.7.2] the analyser gives no finding over this repo's own workflows (BUG-0099)", () => {
	const names = readdirSync(DIR).filter((name) => name.endsWith(".yml"));
	assert.ok(names.length >= 4, "the repo workflows are found");
	const problems: Array<string> = [];
	for (const name of names) {
		const text = readFileSync(`${DIR}${name}`, "utf8").replace(/\r\n/g, "\n");
		const sources = extractShellSources(text, `.github/workflows/${name}`);
		for (const source of sources) {
			const parsed = analyseShell(source);
			if (!parsed.ok) {
				problems.push(`${name}: unparseable ${source.slice(0, 60)}`);
				continue;
			}
			for (const violation of matchDangerousShell(parsed.value)) {
				problems.push(`${name}: ${violation.class} ${violation.detail}`);
			}
		}
	}
	assert.deepEqual(problems, []);
});
