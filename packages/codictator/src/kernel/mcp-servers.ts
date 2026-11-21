// SPEC §4.6.5 core/mcp-declared: the MCP servers a project-level harness
// config file declares, and which of them config.steering.mcpAllowed does
// not list. Pure text in, names out; the rule reads the files through ports.
import { parseJson } from "./json.ts";

// The project-level files of the SPEC §4.6.5 table, in read order.
export const MCP_CONFIG_FILES: ReadonlyArray<string> = [
	".mcp.json",
	".cursor/mcp.json",
	".vscode/mcp.json",
	"opencode.json",
	"opencode.jsonc",
	".opencode/opencode.json",
	".opencode/opencode.jsonc",
	".gemini/settings.json",
	".codex/config.toml",
];

// Servers key per file: a path of object keys from the document root.
const SERVER_KEYS: Readonly<Record<string, ReadonlyArray<string>>> = {
	".vscode/mcp.json": ["servers"],
	"opencode.json": ["mcp", "servers"],
	"opencode.jsonc": ["mcp", "servers"],
	".opencode/opencode.json": ["mcp", "servers"],
	".opencode/opencode.jsonc": ["mcp", "servers"],
};

// JSONC to JSON: comments and trailing commas outside strings removed.
function stripJsonc(text: string): string {
	let out = "";
	let index = 0;
	while (index < text.length) {
		const char = text.charAt(index);
		const pair = text.slice(index, index + 2);
		if (char === '"') {
			let end = index + 1;
			while (end < text.length && text.charAt(end) !== '"') {
				end += text.charAt(end) === "\\" ? 2 : 1;
			}
			out += text.slice(index, end + 1);
			index = end + 1;
		} else if (pair === "//") {
			const end = text.indexOf("\n", index);
			index = end < 0 ? text.length : end;
		} else if (pair === "/*") {
			const end = text.indexOf("*/", index + 2);
			index = end < 0 ? text.length : end + 2;
		} else {
			out += char;
			index += 1;
		}
	}
	return out.replace(/,(\s*[}\]])/g, "$1");
}

function asObject(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function jsonServers(file: string, text: string): Array<string> {
	const parsed = parseJson(file.endsWith(".jsonc") ? stripJsonc(text) : text);
	let at = asObject(parsed.ok ? parsed.value : undefined);
	for (const key of SERVER_KEYS[file] ?? ["mcpServers"]) {
		at = asObject(at?.[key]);
	}
	return Object.keys(at ?? {});
}

// `[mcp_servers.<name>]` and its sub-tables `[mcp_servers.<name>.env]`; the
// name is a bare or a quoted TOML key.
function tomlServers(text: string): Array<string> {
	const names: Array<string> = [];
	for (const line of text.split(/\r?\n/)) {
		const header =
			/^\s*\[\s*mcp_servers\s*\.\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))/.exec(
				line,
			);
		const name = header?.[1] ?? header?.[2] ?? header?.[3];
		if (name !== undefined) {
			names.push(name);
		}
	}
	return names;
}

// Server names one MCP config file declares (empty when it declares none or
// does not parse).
export function mcpServersIn(file: string, text: string): Array<string> {
	const names =
		file === ".codex/config.toml" ? tomlServers(text) : jsonServers(file, text);
	return [...new Set(names)];
}

export function findUndeclaredServers(
	configured: ReadonlyArray<string>,
	allowed: ReadonlyArray<string>,
): Array<string> {
	const known = new Set(allowed);
	const missing: Array<string> = [];
	for (const server of [...configured].sort()) {
		if (!known.has(server) && !missing.includes(server)) {
			missing.push(server);
		}
	}
	return missing;
}
