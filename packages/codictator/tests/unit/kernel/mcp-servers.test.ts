// SPEC §4.6.5 core/mcp-declared: the servers each project-level harness
// config file declares, per the vendor-cited file table.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	findUndeclaredServers,
	MCP_CONFIG_FILES,
	mcpServersIn,
} from "../../../src/kernel/index.ts";

test("[§4.6.5] mcpServersIn reads the servers key of each harness MCP config file", () => {
	const mcpServers = JSON.stringify({ mcpServers: { b: {}, a: {} } });
	for (const file of [
		".mcp.json",
		".cursor/mcp.json",
		".gemini/settings.json",
	]) {
		assert.deepEqual(mcpServersIn(file, mcpServers).sort(), ["a", "b"], file);
	}
	assert.deepEqual(
		mcpServersIn(".vscode/mcp.json", JSON.stringify({ servers: { v: {} } })),
		["v"],
	);
	assert.deepEqual(
		mcpServersIn(".vscode/mcp.json", mcpServers),
		[],
		"the deprecated VS Code file uses servers, not mcpServers",
	);
	const opencode = JSON.stringify({ mcp: { servers: { o: {} } } });
	for (const file of ["opencode.json", ".opencode/opencode.json"]) {
		assert.deepEqual(mcpServersIn(file, opencode), ["o"], file);
	}
	assert.deepEqual(mcpServersIn(".mcp.json", "{ not json"), []);
});

test("[§4.6.5] mcpServersIn reads opencode.jsonc with comments and trailing commas", () => {
	const text = `{\n  // servers\n  "mcp": { /* block */ "servers": { "j": { "url": "http://x//y" }, }, },\n}\n`;
	assert.deepEqual(mcpServersIn("opencode.jsonc", text), ["j"]);
	assert.deepEqual(mcpServersIn(".opencode/opencode.jsonc", text), ["j"]);
});

test("[§4.6.5] mcpServersIn reads the mcp_servers tables of .codex/config.toml", () => {
	const text = `model = "x"\n\n[mcp_servers.alpha]\ncommand = "a"\n\n[mcp_servers.alpha.env]\nK = "v"\n\n[mcp_servers."beta one"]\ncommand = "b"\n\n[features]\nhooks = true\n`;
	assert.deepEqual(mcpServersIn(".codex/config.toml", text), [
		"alpha",
		"beta one",
	]);
	assert.ok(MCP_CONFIG_FILES.includes(".codex/config.toml"));
});

test("[§4.6.5] findUndeclaredServers lists configured servers missing from mcpAllowed, sorted once", () => {
	assert.deepEqual(findUndeclaredServers(["z", "a", "z", "ok"], ["ok"]), [
		"a",
		"z",
	]);
	assert.deepEqual(findUndeclaredServers(["ok"], ["ok"]), []);
});
