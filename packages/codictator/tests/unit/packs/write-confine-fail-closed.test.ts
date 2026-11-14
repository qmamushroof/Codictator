// SPEC §4.7.3 + BUG-0100: a write: target is judged as a path whatever characters it holds,
// and an unparseable shell source blocks CDX-E306; only source-file object syntax is skipped.
import { strict as assert } from "node:assert";
import test from "node:test";
import { judge } from "../../support/write-confine-judge.ts";

const NL = String.fromCharCode(10);

test("[§4.7.3] write-confinement judges a write: target holding code characters outside source files (BUG-0100)", async () => {
	for (const target of ["docs/a=>b.txt", "docs/a|b.txt", "docs/a&b.txt"]) {
		const found = await judge(`write: ${target}${NL}`, "plan.yml");
		assert.equal(found.length, 1, `${target} was not judged`);
		assert.match(found[0]?.message ?? "", /could not resolve/);
	}
});

test("[§4.7.3] write-confinement blocks a ../ escape holding =>, ( or ; outside source files (BUG-0100)", async () => {
	for (const target of [
		"../../etc/x=>y",
		"../../etc/x(y)",
		"../../etc/x;y",
		"../../etc/{x}",
	]) {
		const found = await judge(`write: ${target}${NL}`, "plan.yml");
		assert.ok(
			found.some((finding) => finding.message.includes("escapes")),
			`${target} was not blocked`,
		);
	}
});

test("[§4.7.3] write-confinement blocks a ../ escape in a source file or behind a shell expansion (BUG-0100)", async () => {
	const inSource = await judge(`write: ../../etc/x=>y${NL}`, "a.ts");
	assert.ok(inSource.some((finding) => finding.message.includes("escapes")));
	const run = `steps:${NL}  - run: echo x > ../../etc/$NAME${NL}`;
	const viaShell = await judge(run, "ci.yml");
	assert.ok(viaShell.some((finding) => finding.message.includes("escapes")));
});

test("[§4.7.3] write-confinement leaves code-shaped source targets and shell expansions unresolved but unblocked (BUG-0100)", async () => {
	assert.deepEqual(await judge(`write: "write",${NL}`, "a.ts"), []);
	assert.deepEqual(
		await judge(`write: (chunk: string) => boolean;${NL}`, "a.ts"),
		[],
	);
	const run = `steps:${NL}  - run: echo x >> $GITHUB_OUTPUT${NL}`;
	assert.deepEqual(await judge(run, "ci.yml"), []);
});

test("[§4.7.3] write-confinement judges a proposed L1 target holding code characters (BUG-0100)", async () => {
	const found = await judge("", "plan.yml", ["../../etc/x=>y"]);
	assert.ok(found.some((finding) => finding.message.includes("escapes")));
});

test("[§4.7.3] write-confinement still ignores TS and Python source object syntax (BUG-0094, BUG-0100)", async () => {
	const ts = "const h = {\n\twrite: (\n\t\tpath: string,\n\t) => path,\n};\n";
	assert.deepEqual(await judge(ts, "a.ts"), []);
	assert.deepEqual(await judge(`write: async (a, b) =>${NL}`, "a.ts"), []);
	assert.deepEqual(
		await judge(`write: fs.write(path, data);${NL}`, "a.ts"),
		[],
	);
	const py = `handlers = {${NL}    write: (${NL}    ),${NL}}${NL}`;
	assert.deepEqual(await judge(py, "a.py"), []);
	assert.deepEqual(await judge(`write: fs.write(path, data)${NL}`, "a.py"), []);
});

test("[§4.7.3] write-confinement blocks an unparseable run source with CDX-E306 (BUG-0100)", async () => {
	for (const text of [
		`steps:${NL}  - { name: x, run: echo hi }${NL}`,
		`steps:${NL}  - run: "unclosed${NL}`,
	]) {
		const found = await judge(text, "ci.yml");
		assert.ok(
			found.some((finding) => finding.code === "CDX-E306"),
			`${text} was skipped`,
		);
	}
});
