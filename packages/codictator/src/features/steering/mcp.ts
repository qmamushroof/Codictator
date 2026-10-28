// SPEC §4.6.5 core/mcp-declared: every MCP server in a project-level
// harness config must be listed in config.steering.mcpAllowed.
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

// Fixture-shaped evaluation for the pack self-test (§4.4.4): a tool call
// to a server the markers flag as undeclared violates; a declared one
// passes.
export function evaluateMcpDeclaredMarkers(
	markers: ReadonlyMap<string, string>,
): boolean {
	return (markers.get("declared") ?? "false") !== "true";
}
