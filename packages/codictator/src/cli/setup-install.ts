// SPEC §4.19.4 + §4.19.6 steps 4-5: the engine install layout and the
// clean install here. npm repos install at the root; other repos get
// .codictator/tool/package.json pinning the engine exactly, then npm ci
// runs in the directory owning the lockfile. A registry or network outage
// maps to CDX-E401 (exit 5); any other install failure is a missing
// engine, CDX-E003 (exit 6).
import path from "node:path";
import { ENGINE_VERSION } from "../features/config/index.ts";
import type { Result } from "../kernel/index.ts";
import { err, ok, stableStringify } from "../kernel/index.ts";
import type { SetupStep } from "./setup.ts";
import type { CommandRequest } from "./shared.ts";
import {
	fail,
	portsFor,
	printHuman,
	readStateText,
	writeStateText,
} from "./shared.ts";

export interface SetupInstallTarget {
	readonly dir: string;
	readonly lockRel: string;
	readonly dirRel: string;
}

export async function setupInstallLayout(
	req: CommandRequest,
	root: string,
	steps: Array<SetupStep>,
): Promise<Result<SetupInstallTarget>> {
	const rootManifest = await readStateText(root, "package.json");
	if (rootManifest !== undefined) {
		steps.push({ step: "install", ok: true, detail: { dir: "." } });
		return ok({ dir: root, lockRel: "package-lock.json", dirRel: "." });
	}
	const toolManifest = await readStateText(
		root,
		".codictator/tool/package.json",
	);
	if (toolManifest === undefined) {
		const engineVersion = req.engineVersion ?? ENGINE_VERSION;
		const saved = await writeStateText(
			root,
			".codictator/tool/package.json",
			`${stableStringify({
				name: "codictator-tool",
				private: true,
				dependencies: { codictator: engineVersion },
			})}\n`,
		);
		if (!saved.ok) {
			return err(saved.error);
		}
	}
	steps.push({
		step: "install",
		ok: true,
		detail: { dir: ".codictator/tool" },
	});
	return ok({
		dir: `${root}/.codictator/tool`,
		lockRel: ".codictator/tool/package-lock.json",
		dirRel: ".codictator/tool",
	});
}

function looksLikeRegistryOutage(output: string): boolean {
	return /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|registry/i.test(
		output,
	);
}

// SPEC §4.1.1: the child spawns with shell:false always, so on win32 the
// bare `npm` shim never resolves: it is an npm.cmd batch file, which the
// shell-less spawn cannot execute (ENOENT without, EINVAL with, the
// extension). The fix stays shell-free by exec'ing the real entry beside
// the running node: node <node-dir>/node_modules/npm/bin/npm-cli.js ci.
// POSIX keeps `npm` from PATH. Pure in platform and execPath so tests pin
// the exact proc argv without spawning anything.
export function setupNpmArgv(
	platform: string = process.platform,
	execPath: string = process.execPath,
): ReadonlyArray<string> {
	if (platform !== "win32") {
		return ["npm", "ci"];
	}
	return [
		execPath,
		path.join(
			path.dirname(execPath),
			"node_modules",
			"npm",
			"bin",
			"npm-cli.js",
		),
		"ci",
	];
}

export async function setupInstallHere(
	req: CommandRequest,
	root: string,
	target: SetupInstallTarget,
	steps: Array<SetupStep>,
): Promise<Result<number>> {
	const lock = await readStateText(root, target.lockRel);
	if (lock === undefined) {
		return fail(
			"CDX-E003",
			`no lockfile at ${target.lockRel}, so npm ci cannot run`,
			`Run npm install in ${target.dirRel} (needs network access), then rerun codictator setup.`,
			req.json,
		);
	}
	const ports = await portsFor(root);
	if (!ports.ok) {
		return fail(
			"CDX-E903",
			ports.error.message,
			ports.error.remediation,
			req.json,
		);
	}
	const ran = await ports.value.proc.run(setupNpmArgv(), {
		cwd: target.dir,
		env: {},
		timeoutMs: 300000,
		maxOutputBytes: 4 * 1024 * 1024,
	});
	if (!ran.timedOut && !ran.truncated && ran.code === 0) {
		steps.push({ step: "install-here", ok: true });
		printHuman(`setup: npm ci passed in ${target.dirRel}`, req.quiet);
		return ok(0);
	}
	if (ran.timedOut || looksLikeRegistryOutage(`${ran.stdout}\n${ran.stderr}`)) {
		return fail(
			"CDX-E401",
			"registry or network unavailable during install",
			"Retry with network access, then rerun codictator setup.",
			req.json,
		);
	}
	return fail(
		"CDX-E003",
		`engine install failed in ${target.dirRel} (npm ci exit ${String(ran.code)})`,
		`Run npm ci in ${target.dirRel}, then rerun codictator setup.`,
		req.json,
	);
}
