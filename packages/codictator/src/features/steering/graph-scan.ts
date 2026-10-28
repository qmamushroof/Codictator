// SPEC §4.6.5 core/graph-before-scan: when a knowledge-graph helper has
// output on disk, the first repo-wide search of a session is blocked with
// the helper's lookup instruction; a second identical search passes. The
// rule stays quiet when no graph output exists (SPEC §5.1).
export interface SearchGate {
	readonly graphOutputOnDisk: boolean;
	readonly priorIdenticalSearches: number;
}

export function shouldBlockSearch(gate: SearchGate): boolean {
	return gate.graphOutputOnDisk && gate.priorIdenticalSearches === 0;
}

// The blocked search replies with the helper's lookup instruction, so the
// agent consults the graph instead of rescanning the repo.
export function graphLookupInstruction(helperId = "knowledge-graph"): string {
	return (
		`Consult the ${helperId} helper output before scanning: ` +
		"run the helper's lookup for this query and use its result instead of a repo-wide search."
	);
}

// Fixture-shaped evaluation for the pack self-test (§4.4.4): a full-repo
// scan while the graph is absent violates the graph-first order; a
// graph-guided scan, or one with the graph present, passes.
export function evaluateGraphBeforeScanMarkers(
	markers: ReadonlyMap<string, string>,
): boolean {
	const scan = markers.get("scan") ?? "";
	const graph = markers.get("knowledge-graph") ?? "";
	return scan.includes("full-repo") && graph !== "present";
}
