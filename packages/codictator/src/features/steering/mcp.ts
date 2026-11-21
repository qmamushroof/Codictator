// SPEC §4.6.5 core/mcp-declared: every MCP server in a project-level
// harness config must be listed in config.steering.mcpAllowed. The pure
// comparison lives in the kernel so the pack enforcer shares it (§3.3).
export { findUndeclaredServers } from "../../kernel/index.ts";

// Fixture-shaped evaluation for the pack self-test (§4.4.4): a tool call
// to a server the markers flag as undeclared violates; a declared one
// passes.
export function evaluateMcpDeclaredMarkers(
	markers: ReadonlyMap<string, string>,
): boolean {
	return (markers.get("declared") ?? "false") !== "true";
}
