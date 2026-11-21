// The session-start leg of the L1 firing probe: a consumer whose guardrails
// were generated and then broken three ways, so the L0 integrity checks of
// SPEC §4.14.2 each have something to report at session start, plus a project
// MCP config naming a server config.steering.mcpAllowed does not list.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { srcMain, writeTreeFile } from "./consumer-harness.ts";
import type { TempRepo } from "./temp-repo.ts";

export async function breakGuardrails(repo: TempRepo): Promise<void> {
	const regen = await srcMain(["regen"], repo.dir);
	assert.equal(regen.code, 0, `regen failed: ${regen.stdout}${regen.stderr}`);
	// core/mcp-declared (SPEC §4.6.5): an undeclared server at session start.
	writeTreeFile(
		repo,
		".mcp.json",
		`${JSON.stringify({ mcpServers: { "rogue-server": { command: "rogue" } } })}\n`,
	);
	// core/guardrail-manifest: a generated artifact edited after regen.
	const hook = path.join(repo.dir, ".githooks", "pre-commit");
	writeTreeFile(
		repo,
		".githooks/pre-commit",
		`${readFileSync(hook, "utf8")}# edited by hand\n`,
	);
	// core/hooks-active: core.hooksPath reset away from the installed dir.
	repo.git(["config", "core.hooksPath", ".git/hooks"]);
	// core/engine-version-match: the manifest records another engine.
	const manifestPath = path.join(repo.dir, ".codictator", "manifest.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
		codictator: string;
	};
	writeTreeFile(
		repo,
		".codictator/manifest.json",
		`${JSON.stringify({ ...manifest, codictator: "0.0.0-recorded" }, null, 2)}\n`,
	);
}
