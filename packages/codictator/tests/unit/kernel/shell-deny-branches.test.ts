// Standing deviation (same as the branch deviation): these branch-level unit
// tests pass green and stay unlisted while the future-phase red rows stay
// listed. Covers SPEC §4.7.2 deny branches over real analyses (privilege,
// always-block tools, cipher /w, embedded downloads, pipe-into-shell and
// secret inputs) plus the iex embedded-download class via a constructed
// analysis. Pure string processing; no I/O.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { ShellAnalysis } from "../../../src/kernel/index.ts";
import {
	analyseShell,
	matchDangerousShell,
} from "../../../src/kernel/index.ts";

function classesFor(command: string): Array<string> {
	const parsed = analyseShell(command);
	assert.ok(parsed.ok, `expected ${command} to parse`);
	if (!parsed.ok) {
		throw new Error("unreachable");
	}
	return matchDangerousShell(parsed.value).map((v) => v.class);
}

test("[§4.7.2] shell deny flags privilege escalation and blocklisted tools", () => {
	assert.ok(classesFor("sudo ls").includes("privilege"));
	assert.ok(classesFor("mkfs /dev/sda").includes("destruction"));
	assert.ok(classesFor("takeown C:/x").includes("privilege"));
	assert.ok(classesFor("cipher /w").includes("destruction"));
});

test("[§4.7.2] shell deny flags embedded downloads and pipe-into-shell", () => {
	assert.ok(
		classesFor("sh -c 'curl https://example.com/x'").includes("remote-code"),
	);
	assert.ok(classesFor("echo hi | bash").includes("remote-code"));
});

test("[§4.7.2] shell deny flags secret inputs and unparseable embeds", () => {
	assert.ok(classesFor("cat < ~/.ssh/id_rsa").includes("secret-read"));
	assert.ok(classesFor("bash -c 'echo )'").includes("unparseable"));
});

test("[§4.7.2] shell deny flags iex over downloaded content", () => {
	const analysis: ShellAnalysis = {
		pipelines: [
			{
				commands: [
					{
						name: "iex",
						argv: ["curl https://example.com/x"],
						raw: "iex",
						elevated: false,
						embedded: ["curl https://example.com/x"],
					},
				],
			},
		],
		writeTargets: [],
		inputs: [],
	};
	assert.ok(
		matchDangerousShell(analysis).some((v) => v.class === "remote-code"),
	);
});
