// SPEC §4.6.5 core/mcp-declared on the live repo: L0 at session start and L4
// over a verify range read the project-level harness MCP configs and compare
// the servers with config.steering.mcpAllowed.
import { strict as assert } from "node:assert";
import test from "node:test";
import { resolveCodeEnforcer } from "../../../src/features/packs/enforcers/code.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";
import { createFakePorts } from "../../support/fake-ports.ts";
import { DECL, ruleFor } from "../../support/pre-tool-scenario.ts";

const RULE = "core/mcp-declared";

function configWith(allowed: ReadonlyArray<string>): string {
	return JSON.stringify({
		version: 1,
		codictator: "1.0.0",
		steering: { mcpAllowed: allowed },
	});
}

async function run(
	files: Readonly<Record<string, string>>,
	trigger: "startup" | "review",
	base?: string,
): Promise<Array<{ path: string | undefined; message: string }>> {
	const fakes = createFakePorts();
	for (const [name, text] of Object.entries(files)) {
		fakes.fs.seedText(name, text);
	}
	const resolved = resolveCodeEnforcer(DECL, ruleFor(RULE), fakes.ports);
	assert.ok(resolved.ok && resolved.value !== undefined);
	const found = await resolved.value.check(
		{
			trigger,
			scope: { files: [], ...(base === undefined ? {} : { base }) },
			now: FIXED_INSTANT,
			configHash: "h",
		},
		{},
	);
	for (const finding of found) {
		assert.equal(finding.ruleId, RULE);
	}
	return found.map(({ path, message }) => ({ path, message }));
}

const MCP = JSON.stringify({ mcpServers: { rogue: {}, listed: {} } });

test("[§4.6.5] L0 core/mcp-declared names a server in a project MCP config that mcpAllowed lacks", async () => {
	const found = await run(
		{ ".codictator/config.json": configWith(["listed"]), ".mcp.json": MCP },
		"startup",
	);
	assert.equal(found.length, 1);
	assert.equal(found[0]?.path, ".mcp.json");
	assert.ok(found[0]?.message.includes("rogue"), found[0]?.message);
	const codex = await run(
		{
			".codictator/config.json": configWith([]),
			".codex/config.toml": '[mcp_servers.tomlsrv]\ncommand = "x"\n',
		},
		"startup",
	);
	assert.equal(codex[0]?.path, ".codex/config.toml");
});

test("[§4.6.5] L0 core/mcp-declared stays quiet when every server is listed or no MCP config exists", async () => {
	assert.deepEqual(
		await run(
			{
				".codictator/config.json": configWith(["listed", "rogue"]),
				".mcp.json": MCP,
			},
			"startup",
		),
		[],
	);
	assert.deepEqual(
		await run({ ".codictator/config.json": configWith([]) }, "startup"),
		[],
	);
});

test("[§4.6.5] L4 core/mcp-declared judges the head MCP configs only over a range base", async () => {
	const files = {
		".codictator/config.json": configWith(["listed"]),
		".mcp.json": MCP,
	};
	assert.equal((await run(files, "review", "BASE")).length, 1);
	assert.deepEqual(await run(files, "review"), []);
});
